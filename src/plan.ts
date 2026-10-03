import { candidatesFor } from "./candidates.ts";
import { filterOnly } from "./check.ts";
import type { Config, Level, Rule, RuleKind, RuleOf, Scope } from "./config.ts";
import { type RuleContext, selectRuleFiles } from "./rules/deterministic.ts";

/** What `check` would look at for one rule, without reading anything. */
export interface PlanRule {
  id: string;
  kind: RuleKind;
  level: Level;
  files: string[];
  /** Model requests this rule would make: one per file, or one for a set. Zero for other kinds. */
  requests: number;
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

/** `files` rules list what their globs select; path rules list their patterns as written, since nothing is read. */
const PATHS: { [K in RuleKind]: Paths<K> } = {
  forbid: selectRuleFiles,
  require: selectRuleFiles,
  standard: selectRuleFiles,
  exists: async (rule) => rule.exists,
  absent: async (rule) => rule.absent,
};

/** Requests by scope: one per file, or one for the whole set when it has any files. */
const REQUESTS: Record<Scope, (files: number) => number> = {
  file: (files) => files,
  set: (files) => Math.min(files, 1),
};

function requestsOf(rule: Rule, files: number): number {
  return rule.kind === "standard" ? REQUESTS[rule.scope](files) : 0;
}

async function planRule(rule: Rule, ctx: RuleContext): Promise<PlanRule> {
  // Each lister takes its own rule kind; `kind` has already picked the right one.
  const files = await PATHS[rule.kind](rule as never, ctx);
  const requests = requestsOf(rule, files.length);
  return { id: rule.id, kind: rule.kind, level: rule.level, files, requests };
}

/** Every rule's requests, or none when the run skips models. */
function requestsFor(rules: PlanRule[], llm: boolean | undefined): number {
  return llm === false ? 0 : rules.reduce((total, rule) => total + rule.requests, 0);
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
