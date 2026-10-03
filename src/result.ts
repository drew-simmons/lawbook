import type { Level, Rule, RuleKind } from "./config.ts";
import { type Decision, NO_USAGE, type Usage } from "./judge/judge.ts";

/** One place a rule found wrong. `path` and `line` are relative to the root. */
export interface Finding {
  path?: string;
  line?: number;
  message: string;
  /** The model's decision on the file. Only `standard` rules set it. */
  decision?: Decision;
}

/** A file a rule selected but left out, and why. It does not affect the status. */
export interface Skipped {
  path: string;
  message: string;
}

/**
 * Tokens and calls summed over verdicts. `requests` went to the provider;
 * `cached` came from the verdict cache and cost nothing.
 */
export interface UsageTotals extends Usage {
  requests: number;
  cached: number;
}

export const NO_TOTALS: UsageTotals = { ...NO_USAGE, requests: 0, cached: 0 };

export function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    requests: a.requests + b.requests,
    cached: a.cached + b.cached,
  };
}

/** `error` means at least one file could not be judged; its findings say why. */
export type RuleStatus = "pass" | "fail" | "warn" | "error" | "skip";

export interface RuleResult {
  id: string;
  kind: RuleKind;
  level: Level;
  /** The rule's `description`, when it has one. */
  description?: string;
  status: RuleStatus;
  findings: Finding[];
  /** Every judged file's decision, keyed by path. Only judged `scope: file` rules set it. */
  decisions?: Record<string, Decision>;
  /** The one decision on the whole set. Only judged `scope: set` rules set it. */
  decision?: Decision;
  /** Why each passing file passed, keyed by path. Only `--explain` on a judged `scope: file` rule sets it. */
  reasons?: Record<string, string>;
  /** Why the set passed. Only `--explain` on a passing `scope: set` rule sets it. */
  reason?: string;
  /** Files left out and why. Present only when there are any. */
  skipped?: Skipped[];
  /** What the rule's requests cost. Only judged `standard` rules set it. */
  usage?: UsageTotals;
}

export interface Summary {
  passed: number;
  failed: number;
  warned: number;
  errored: number;
  skipped: number;
  /** What the whole run cost. Zero when no rule asked a model. */
  usage: UsageTotals;
}

/** The counts in the summary, which the text format prints in this order. */
export type Count = Exclude<keyof Summary, "usage">;

export interface Report {
  results: RuleResult[];
  summary: Summary;
}

/** What a rule with findings reports: its level decides. */
const FINDINGS_STATUS: Record<Level, RuleStatus> = { error: "fail", warn: "warn" };

/** What every result carries over from its rule. */
function base(rule: Rule): Pick<RuleResult, "id" | "kind" | "level" | "description"> {
  return { id: rule.id, kind: rule.kind, level: rule.level, description: rule.description };
}

/** A rule passes when it has no findings. */
export function ruleResult(rule: Rule, findings: Finding[]): RuleResult {
  const status = findings.length === 0 ? "pass" : FINDINGS_STATUS[rule.level];
  return { ...base(rule), status, findings };
}

/** `skipped` only when there is something to list, so other results keep their shape. */
export function withSkipped(result: RuleResult, skipped: Skipped[]): RuleResult {
  return skipped.length === 0 ? result : { ...result, skipped };
}

/** A rule the run did not evaluate, such as a `standard` rule under `--no-llm`. */
export function skipResult(rule: Rule): RuleResult {
  return { ...base(rule), status: "skip", findings: [] };
}

const COUNTERS: Record<RuleStatus, Count> = {
  pass: "passed",
  fail: "failed",
  warn: "warned",
  error: "errored",
  skip: "skipped",
};

export function summarize(results: RuleResult[]): Report {
  const usage = results.reduce(
    (total, result) => addTotals(total, result.usage ?? NO_TOTALS),
    NO_TOTALS,
  );
  const summary: Summary = { passed: 0, failed: 0, warned: 0, errored: 0, skipped: 0, usage };
  for (const result of results) {
    summary[COUNTERS[result.status]] += 1;
  }
  return { results, summary };
}

/**
 * Exit code 2 when a rule could not be judged, else 1 when a requested check
 * failed. `warn` rules never set either.
 */
export function exitCodeFor(report: Report): 0 | 1 | 2 {
  if (report.summary.errored > 0) {
    return 2;
  }
  return report.summary.failed === 0 ? 0 : 1;
}
