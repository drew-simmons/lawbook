import type { Config, Rule, RuleKind, RuleOf } from "./config.ts";
import { CliError } from "./errors.ts";
import { underRoot } from "./files.ts";
import { changedFiles, listedFiles } from "./git.ts";
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
  /** The provider factories; the config's `llm.provider` picks one. */
  judges: Judges;
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

/** A judge only when a selected rule needs one, so other runs never touch a provider. */
async function judgeFor(rules: Rule[], options: CheckOptions): Promise<Judge | undefined> {
  const wanted = options.llm !== false && rules.some((rule) => rule.kind === "standard");
  const { llm } = options.config;
  return wanted ? options.judges[llm.provider](llm) : undefined;
}

/** The root-relative paths `files` names; those outside the root are dropped. */
function namedFiles(root: string, files: string[] | undefined): string[] | undefined {
  return files === undefined ? undefined : files.flatMap((file) => underRoot(root, file) ?? []);
}

function workingTreeFiles(options: CheckOptions): Promise<string[] | undefined> {
  return options.changed === true ? changedFiles(options.root) : Promise.resolve(undefined);
}

function committedFiles(options: CheckOptions): Promise<string[] | undefined> {
  const { root, since } = options;
  return since === undefined ? Promise.resolve(undefined) : changedFiles(root, since);
}

/** What git tracks or does not ignore, when the config respects `.gitignore` and git knows the root. */
async function gitCandidates(options: CheckOptions): Promise<Set<string> | undefined> {
  const listed = options.config.gitignore ? await listedFiles(options.root) : undefined;
  return listed === undefined ? undefined : new Set(listed);
}

/**
 * The files `files` rules may select: the union of every selector given;
 * else what `.gitignore` leaves, in a git work tree; else undefined, so
 * every file may be.
 */
async function candidatesFor(options: CheckOptions): Promise<Set<string> | undefined> {
  const selected = [
    namedFiles(options.root, options.files),
    await workingTreeFiles(options),
    await committedFiles(options),
  ].filter((paths) => paths !== undefined);
  return selected.length === 0 ? gitCandidates(options) : new Set(selected.flat());
}

/** Runs the rules in config order and reports every result. */
export async function check(options: CheckOptions): Promise<Report> {
  const rules = filterOnly(options.config.rules, options.only);
  const ctx: JudgeContext = {
    root: options.root,
    ignore: options.config.ignore,
    candidates: await candidatesFor(options),
    judge: await judgeFor(rules, options),
    concurrency: options.config.llm.concurrency,
    maxBytes: options.config.llm.maxBytes,
  };
  const results: RuleResult[] = [];
  for (const rule of rules) {
    results.push(await runRule(rule, ctx));
  }
  return summarize(results);
}
