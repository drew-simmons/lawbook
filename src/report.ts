import type { Finding, Report, RuleResult, RuleStatus } from "./result.ts";

const LABELS: Record<RuleStatus, string> = { pass: "PASS", fail: "FAIL", skip: "SKIP" };

/** `path:line: ` when the finding has a location, else nothing. */
function location(finding: Finding): string {
  const parts = [finding.path, finding.line].filter((part) => part !== undefined);
  return parts.length === 0 ? "" : `${parts.join(":")}: `;
}

function resultLines(result: RuleResult): string[] {
  const findings = result.findings.map((finding) => `  ${location(finding)}${finding.message}`);
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
