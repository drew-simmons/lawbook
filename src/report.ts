import type { Finding, Report, RuleResult, RuleStatus, Summary } from "./result.ts";

/** What a formatter may need beyond the report itself. */
export interface ReportMeta {
  /** The lawbook version, for formats that name the tool. */
  version: string;
  /** The checked directory, for formats that need absolute locations. */
  root: string;
}

export type Formatter = (report: Report, meta: ReportMeta) => string;

const LABELS: Record<RuleStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  error: "ERROR",
  skip: "SKIP",
};

/** The summary line always prints every count, in this order. */
const SUMMARY_ORDER: (keyof Summary)[] = ["passed", "failed", "warned", "errored", "skipped"];

/** `path:line: ` when the finding has a location, else nothing. */
function location(finding: Finding): string {
  const parts = [finding.path, finding.line].filter((part) => part !== undefined);
  return parts.length === 0 ? "" : `${parts.join(":")}: `;
}

/** ` (noul 0.12)` when the finding carries a decision, else nothing. */
export function probability(finding: Finding): string {
  const { decision } = finding;
  return decision === undefined ? "" : ` (noul ${decision.noul.toFixed(2)})`;
}

function resultLines(result: RuleResult): string[] {
  const findings = result.findings.map(
    (finding) => `  ${location(finding)}${finding.message}${probability(finding)}`,
  );
  return [`${LABELS[result.status]} ${result.id}`, ...findings];
}

export function summaryLine(summary: Summary): string {
  return SUMMARY_ORDER.map((key) => `${summary[key]} ${key}`).join(", ");
}

export function formatText(report: Report): string {
  const lines = report.results.flatMap(resultLines);
  return [...lines, "", summaryLine(report.summary), ""].join("\n");
}

export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
