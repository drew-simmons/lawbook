import type { Finding, Report, RuleResult, RuleStatus } from "./result.ts";

const LABELS: Record<RuleStatus, string> = { pass: "PASS", fail: "FAIL", skip: "SKIP" };

/** `path:line: ` when the finding has a location, else nothing. */
function location(finding: Finding): string {
  const parts = [finding.path, finding.line].filter((part) => part !== undefined);
  return parts.length === 0 ? "" : `${parts.join(":")}: `;
}

/** ` (noul 0.12)` when the finding carries a yes/no decision, else nothing. */
function probability(finding: Finding): string {
  const { decision } = finding;
  return decision?.type === "noul" ? ` (noul ${decision.noul.toFixed(2)})` : "";
}

function resultLines(result: RuleResult): string[] {
  const findings = result.findings.map(
    (finding) => `  ${location(finding)}${finding.message}${probability(finding)}`,
  );
  return [`${LABELS[result.status]} ${result.id}`, ...findings];
}

export function formatText(report: Report): string {
  const { passed, failed, skipped } = report.summary;
  const lines = report.results.flatMap(resultLines);
  return [...lines, "", `${passed} passed, ${failed} failed, ${skipped} skipped`, ""].join("\n");
}

export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export const FORMATTERS = { text: formatText, json: formatJson };

export type Format = keyof typeof FORMATTERS;
