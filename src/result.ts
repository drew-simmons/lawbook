import type { Level, Rule, RuleKind } from "./config.ts";
import type { Decision } from "./judge/judge.ts";

/** One place a rule found wrong. `path` and `line` are relative to the root. */
export interface Finding {
  path?: string;
  line?: number;
  message: string;
  /** The model's decision on the file. Only `standard` rules set it. */
  decision?: Decision;
}

/** `error` means at least one file could not be judged; its findings say why. */
export type RuleStatus = "pass" | "fail" | "warn" | "error" | "skip";

export interface RuleResult {
  id: string;
  kind: RuleKind;
  level: Level;
  status: RuleStatus;
  findings: Finding[];
  /** Every judged file's decision, keyed by path. Only judged `standard` rules set it. */
  decisions?: Record<string, Decision>;
}

export interface Summary {
  passed: number;
  failed: number;
  warned: number;
  errored: number;
  skipped: number;
}

export interface Report {
  results: RuleResult[];
  summary: Summary;
}

/** What a rule with findings reports: its level decides. */
const FINDINGS_STATUS: Record<Level, RuleStatus> = { error: "fail", warn: "warn" };

/** A rule passes when it has no findings. */
export function ruleResult(rule: Rule, findings: Finding[]): RuleResult {
  const status = findings.length === 0 ? "pass" : FINDINGS_STATUS[rule.level];
  return { id: rule.id, kind: rule.kind, level: rule.level, status, findings };
}

const COUNTERS: Record<RuleStatus, keyof Summary> = {
  pass: "passed",
  fail: "failed",
  warn: "warned",
  error: "errored",
  skip: "skipped",
};

export function summarize(results: RuleResult[]): Report {
  const summary: Summary = { passed: 0, failed: 0, warned: 0, errored: 0, skipped: 0 };
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
