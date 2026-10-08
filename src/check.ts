import path from "node:path";
import { selectionFor } from "./candidates.ts";
import {
  type Config,
  type LlmConfig,
  type Rule,
  type RuleKind,
  type RuleOf,
  ruleLlm,
} from "./config.ts";
import { CliError } from "./errors.ts";
import { cachedJudge, DEFAULT_CACHE_DIR } from "./judge/cache.ts";
import type { Judge, Judges } from "./judge/judge.ts";
import { type Report, type RuleResult, summarize } from "./result.ts";
import { checkAbsent, checkExists, checkForbid, checkRequire } from "./rules/deterministic.ts";
import { checkStandard, type JudgeContext } from "./rules/llm.ts";

export interface CheckOptions {
  /** The directory the rules apply to. */
  root: string;
  config: Config;
  /** Run only the rules with these ids. */
  only?: string[];
  /** `false` reports `standard` rules as skipped instead of asking a model. */
  llm?: boolean;
  /** Check only these files, given relative to the current directory or absolute. */
  files?: string[];
  /** Check only files changed in the working tree against HEAD. */
  changed?: boolean;
  /** Check only files committed since the merge base with this ref. */
  since?: string;
  /** `false` asks the model even when a cached verdict exists. */
  cache?: boolean;
  /** Where verdicts are cached; default `node_modules/.cache/lawbook` under the root. */
  cacheDir?: string;
  /** The provider factories; the config's `llm.provider` picks one. */
  judges: Judges;
  /** Keep the model's reason for files that pass, not only for findings. */
  explain?: boolean;
}

type Runner<K extends RuleKind> = (rule: RuleOf<K>, ctx: JudgeContext) => Promise<RuleResult>;

const runners: { [K in RuleKind]: Runner<K> } = {
  forbid: checkForbid,
  require: checkRequire,
  exists: checkExists,
  absent: checkAbsent,
  standard: checkStandard,
};

function runRule(rule: Rule, ctx: JudgeContext): Promise<RuleResult> {
  // Each runner takes its own rule kind; `kind` has already picked the right one.
  return runners[rule.kind](rule as never, ctx);
}

/** The rules `only` names, or all of them. Unknown ids are an input error. */
export function filterOnly(rules: Rule[], only: string[] | undefined): Rule[] {
  if (only === undefined) {
    return rules;
  }
  const unknown = only.filter((id) => !rules.some((rule) => rule.id === id));
  if (unknown.length > 0) {
    throw new CliError(`unknown rule id: ${unknown.join(", ")}`);
  }
  return rules.filter((rule) => only.includes(rule.id));
}

function cacheDirFor(options: CheckOptions): string {
  return options.cacheDir ?? path.join(options.root, DEFAULT_CACHE_DIR);
}

/** The judge behind the verdict cache, unless the flag or the config turns it off. */
function withCache(judge: Judge, llm: LlmConfig, options: CheckOptions): Judge {
  const on = options.cache !== false && llm.cache;
  return on ? cachedJudge(judge, cacheDirFor(options), llm.model) : judge;
}

/** What makes two rules share a judge: the same provider, model, and region. */
function llmKey(llm: LlmConfig): string {
  return JSON.stringify([llm.provider, llm.model, llm.region ?? null]);
}

/** One judge per distinct `llm`, reused across the rules that share it. */
async function judgeOf(
  llm: LlmConfig,
  built: Map<string, Judge>,
  options: CheckOptions,
): Promise<Judge> {
  const key = llmKey(llm);
  const judge = built.get(key) ?? withCache(await options.judges[llm.provider](llm), llm, options);
  built.set(key, judge);
  return judge;
}

function isStandard(rule: Rule): rule is RuleOf<"standard"> {
  return rule.kind === "standard";
}

/**
 * A judge for every selected `standard` rule, keyed by rule id, built before
 * any rule runs so a client problem stops the run first. Nothing is built
 * when no rule needs one, so other runs never touch a provider.
 */
export async function judgesFor(
  rules: Rule[],
  options: CheckOptions,
): Promise<Map<string, Judge> | undefined> {
  const standards = options.llm === false ? [] : rules.filter(isStandard);
  if (standards.length === 0) {
    return undefined;
  }
  const built = new Map<string, Judge>();
  const judges = new Map<string, Judge>();
  for (const rule of standards) {
    judges.set(rule.id, await judgeOf(ruleLlm(options.config.llm, rule), built, options));
  }
  return judges;
}

/** Runs the rules in config order and reports every result. */
export async function check(options: CheckOptions): Promise<Report> {
  const rules = filterOnly(options.config.rules, options.only);
  const ctx: JudgeContext = {
    root: options.root,
    ignore: options.config.ignore,
    ...(await selectionFor(options)),
    judges: await judgesFor(rules, options),
    concurrency: options.config.llm.concurrency,
    maxBytes: options.config.llm.maxBytes,
    explain: options.explain === true,
  };
  const results: RuleResult[] = [];
  for (const rule of rules) {
    results.push(await runRule(rule, ctx));
  }
  return summarize(results);
}
