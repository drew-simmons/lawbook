import { candidatesFor } from "./candidates.ts";
import { filterOnly } from "./check.ts";
import type { Config, Level, Rule, RuleKind, RuleOf } from "./config.ts";
import { type RuleContext, selectRuleFiles } from "./rules/deterministic.ts";

/** What `check` would look at for one rule, without reading anything. */
export interface PlanRule {
  id: string;
  kind: RuleKind;
  level: Level;
  files: string[];
}

export interface Plan {
  rules: PlanRule[];
  /** How many model requests the run would make: one per selected file of a `standard` rule. */
  requests: number;
}

export interface PlanOptions {
  root: string;
  config: Config;
  only?: string[];
  llm?: boolean;
  files?: string[];
  changed?: boolean;
  since?: string;
}

type Paths<K extends RuleKind> = (rule: RuleOf<K>, ctx: RuleContext) => Promise<string[]>;

/** `files` rules list what their globs select; path rules list the one path they look at. */
const PATHS: { [K in RuleKind]: Paths<K> } = {
  forbid: selectRuleFiles,
  require: selectRuleFiles,
  standard: selectRuleFiles,
  exists: async (rule) => [rule.exists],
  absent: async (rule) => [rule.absent],
};

async function planRule(rule: Rule, ctx: RuleContext): Promise<PlanRule> {
  // Each lister takes its own rule kind; `kind` has already picked the right one.
  const files = await PATHS[rule.kind](rule as never, ctx);
  return { id: rule.id, kind: rule.kind, level: rule.level, files };
}

/** One request per selected file of a `standard` rule, or none when the run skips models. */
function requestsFor(rules: PlanRule[], llm: boolean | undefined): number {
  const standard = rules.filter((rule) => rule.kind === "standard");
  return llm === false ? 0 : standard.reduce((total, rule) => total + rule.files.length, 0);
}

/** The files each selected rule would look at, found the way `check` finds them. */
export async function plan(options: PlanOptions): Promise<Plan> {
  const rules = filterOnly(options.config.rules, options.only);
  const ctx: RuleContext = {
    root: options.root,
    ignore: options.config.ignore,
    candidates: await candidatesFor(options),
  };
  const planned = await Promise.all(rules.map((rule) => planRule(rule, ctx)));
  return { rules: planned, requests: requestsFor(planned, options.llm) };
}
