import type { Finding, Report, RuleResult, RuleStatus, Summary } from "./result.ts";

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
function probability(finding: Finding): string {
  const { decision } = finding;
  return decision === undefined ? "" : ` (noul ${decision.noul.toFixed(2)})`;
}

function resultLines(result: RuleResult): string[] {
  const findings = result.findings.map(
    (finding) => `  ${location(finding)}${finding.message}${probability(finding)}`,
  );
  return [`${LABELS[result.status]} ${result.id}`, ...findings];
}

function summaryLine(summary: Summary): string {
  return SUMMARY_ORDER.map((key) => `${summary[key]} ${key}`).join(", ");
}

export function formatText(report: Report): string {
  const lines = report.results.flatMap(resultLines);
  return [...lines, "", summaryLine(report.summary), ""].join("\n");
}

export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export const FORMATTERS = { text: formatText, json: formatJson };

export type Format = keyof typeof FORMATTERS;
