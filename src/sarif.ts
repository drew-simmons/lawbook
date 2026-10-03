import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ReportMeta } from "./report.ts";
import type { Finding, Report, RuleResult } from "./result.ts";

const SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const INFORMATION_URI = "https://drew-simmons.github.io/lawbook/";

function region(finding: Finding): object {
  return finding.line === undefined ? {} : { region: { startLine: finding.line } };
}

/** A location under the `ROOT` base, when the finding names a file. */
function locations(finding: Finding): object {
  if (finding.path === undefined) {
    return {};
  }
  const artifactLocation = { uri: finding.path, uriBaseId: "ROOT" };
  return { locations: [{ physicalLocation: { artifactLocation, ...region(finding) } }] };
}

function resultOf(rule: RuleResult, finding: Finding): object {
  return {
    ruleId: rule.id,
    level: rule.status === "warn" ? "warning" : "error",
    message: { text: finding.message },
    ...locations(finding),
  };
}

function ruleOf(result: RuleResult): object {
  return { id: result.id, shortDescription: { text: result.description ?? result.id } };
}

/** The checked directory as a file URL with a trailing slash, as SARIF base ids want. */
function rootUri(root: string): string {
  return `${pathToFileURL(path.resolve(root)).href}/`;
}

/** A SARIF 2.1.0 log with one run, one rule per result, and one result per finding. */
export function formatSarif(report: Report, meta: ReportMeta): string {
  const driver = {
    name: "lawbook",
    version: meta.version,
    informationUri: INFORMATION_URI,
    rules: report.results.map(ruleOf),
  };
  const results = report.results.flatMap((rule) =>
    rule.findings.map((finding) => resultOf(rule, finding)),
  );
  const run = {
    tool: { driver },
    originalUriBaseIds: { ROOT: { uri: rootUri(meta.root) } },
    results,
  };
  return `${JSON.stringify({ $schema: SCHEMA, version: "2.1.0", runs: [run] }, null, 2)}\n`;
}
