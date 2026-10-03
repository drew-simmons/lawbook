import { probability, summaryLine } from "./report.ts";
import type { Finding, Report, RuleResult } from "./result.ts";

/** Workflow command data: `%`, carriage returns, and newlines are escaped. */
function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** Property values also escape the separators the command syntax uses. */
function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** `file=`, `line=`, and `title=` for the values the finding has. */
function properties(result: RuleResult, finding: Finding): string {
  const pairs: [string, string | number | undefined][] = [
    ["file", finding.path],
    ["line", finding.line],
    ["title", result.id],
  ];
  return pairs
    .flatMap(([key, value]) =>
      value === undefined ? [] : [`${key}=${escapeProperty(String(value))}`],
    )
    .join(",");
}

/** A `warn` rule's findings annotate as warnings; every other finding is an error. */
function command(result: RuleResult): string {
  return result.status === "warn" ? "warning" : "error";
}

function findingLine(result: RuleResult, finding: Finding): string {
  const message = escapeData(`${finding.message}${probability(finding)}`);
  return `::${command(result)} ${properties(result, finding)}::${message}`;
}

/** One GitHub Actions workflow command per finding, then the summary as a notice. */
export function formatGithub(report: Report): string {
  const lines = report.results.flatMap((result) =>
    result.findings.map((finding) => findingLine(result, finding)),
  );
  return [...lines, `::notice title=lawbook::${summaryLine(report.summary)}`, ""].join("\n");
}
