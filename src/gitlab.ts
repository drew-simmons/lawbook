import { createHash } from "node:crypto";
import { probability, type ReportMeta } from "./report.ts";
import type { Finding, Report, RuleResult, RuleStatus } from "./result.ts";

/** One entry in a GitLab code quality report. */
export interface GitlabIssue {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: string;
  location: { path: string; lines: { begin: number } };
}

/** Findings under a failing rule are major, under a `warn` rule minor, and provider errors critical. */
const SEVERITY: Record<RuleStatus, string> = {
  fail: "major",
  warn: "minor",
  error: "critical",
  pass: "info",
  skip: "info",
};

/** Stable across runs and line drift: the rule, the path, and the message, not the line. */
export function fingerprint(result: RuleResult, finding: Finding): string {
  return createHash("sha256")
    .update([result.id, finding.path ?? "", finding.message].join("\0"))
    .digest("hex");
}

/** A finding without a path, such as a missing file, is reported against the config file. */
function issueOf(result: RuleResult, finding: Finding, meta: ReportMeta): GitlabIssue {
  return {
    description: `${finding.message}${probability(finding)}`,
    check_name: result.id,
    fingerprint: fingerprint(result, finding),
    severity: SEVERITY[result.status],
    location: { path: finding.path ?? meta.config, lines: { begin: finding.line ?? 1 } },
  };
}

/** A GitLab code quality report: a JSON array with one issue per finding. */
export function formatGitlab(report: Report, meta: ReportMeta): string {
  const issues = report.results.flatMap((result) =>
    result.findings.map((finding) => issueOf(result, finding, meta)),
  );
  return `${JSON.stringify(issues, null, 2)}\n`;
}
