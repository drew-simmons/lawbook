import type { Config, Rule, RuleKind, RuleOf } from "./config.ts";
import { CliError } from "./errors.ts";
import { type Report, type RuleResult, summarize } from "./result.ts";
import {
  checkAbsent,
  checkExists,
  checkForbid,
  checkRequire,
  type RuleContext,
} from "./rules/deterministic.ts";

export interface CheckOptions {
  /** The directory the rules apply to. */
  root: string;
  config: Config;
  /** Run only the rules with these ids. */
  only?: string[];
}

type Runner<K extends RuleKind> = (rule: RuleOf<K>, ctx: RuleContext) => Promise<RuleResult>;

const runners: { [K in RuleKind]: Runner<K> } = {
  forbid: checkForbid,
  require: checkRequire,
  exists: checkExists,
  absent: checkAbsent,
};

function runRule(rule: Rule, ctx: RuleContext): Promise<RuleResult> {
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

/** Runs the rules in config order and reports every result. */
export async function check(options: CheckOptions): Promise<Report> {
  const ctx: RuleContext = { root: options.root, ignore: options.config.ignore };
  const results: RuleResult[] = [];
  for (const rule of filterOnly(options.config.rules, options.only)) {
    results.push(await runRule(rule, ctx));
  }
  return summarize(results);
}
