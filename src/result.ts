import type { Rule, RuleKind } from "./config.ts";
import type { Decision } from "./judge/judge.ts";

/** One place a rule found wrong. `path` and `line` are relative to the root. */
export interface Finding {
  path?: string;
  line?: number;
  message: string;
  /** The model's decision on the file. Only `standard` rules set it. */
  decision?: Decision;
}

export type RuleStatus = "pass" | "fail" | "skip";

export interface RuleResult {
  id: string;
  kind: RuleKind;
  status: RuleStatus;
  findings: Finding[];
  /** Every judged file's decision, keyed by path. Only judged `standard` rules set it. */
  decisions?: Record<string, Decision>;
}

export interface Summary {
  passed: number;
  failed: number;
  skipped: number;
}

export interface Report {
  results: RuleResult[];
  summary: Summary;
}

/** A rule passes when it has no findings. */
export function ruleResult(rule: Rule, findings: Finding[]): RuleResult {
  const status = findings.length === 0 ? "pass" : "fail";
  return { id: rule.id, kind: rule.kind, status, findings };
}

const COUNTERS: Record<RuleStatus, keyof Summary> = {
  pass: "passed",
  fail: "failed",
  skip: "skipped",
};

export function summarize(results: RuleResult[]): Report {
  const summary: Summary = { passed: 0, failed: 0, skipped: 0 };
  for (const result of results) {
    summary[COUNTERS[result.status]] += 1;
  }
  return { results, summary };
}

/** Exit code 1 means a requested check failed. */
export function exitCodeFor(report: Report): 0 | 1 {
  return report.summary.failed === 0 ? 0 : 1;
}
