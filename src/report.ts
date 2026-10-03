import type { FixtureCase, FixtureReport, FixtureRule } from "./fixtures.ts";
import type { Plan, PlanRule } from "./plan.ts";
import type {
  Count,
  Finding,
  Report,
  RuleResult,
  RuleStatus,
  Summary,
  UsageTotals,
} from "./result.ts";

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
const SUMMARY_ORDER: Count[] = ["passed", "failed", "warned", "errored", "skipped"];

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

/** ` (noul 0.93)` for the decision a passing path or set got, else nothing. */
function passedProbability(result: RuleResult, path?: string): string {
  const decision = path === undefined ? result.decision : result.decisions?.[path];
  return probability({ message: "", decision });
}

/** `  path: passed, <reason> (noul 0.93)` per explained file, or one line for an explained set. */
function reasonLines(result: RuleResult): string[] {
  const files = Object.entries(result.reasons ?? {}).map(
    ([path, reason]) => `  ${path}: passed, ${reason}${passedProbability(result, path)}`,
  );
  const set =
    result.reason === undefined ? [] : [`  passed, ${result.reason}${passedProbability(result)}`];
  return [...files, ...set];
}

function resultLines(result: RuleResult): string[] {
  const findings = result.findings.map(
    (finding) => `  ${location(finding)}${finding.message}${probability(finding)}`,
  );
  const skipped = (result.skipped ?? []).map((entry) => `  ${entry.path}: ${entry.message}`);
  return [`${LABELS[result.status]} ${result.id}`, ...findings, ...reasonLines(result), ...skipped];
}

export function summaryLine(summary: Summary): string {
  return SUMMARY_ORDER.map((key) => `${summary[key]} ${key}`).join(", ");
}

/** `1 request`, `2 requests`. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** What the run cost, only when a model was involved; input counts every token it read. */
function usageLine(usage: UsageTotals): string[] {
  const input = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
  const line = `${count(usage.requests, "request")} (${usage.cached} cached), ${count(input, "input token")}, ${count(usage.outputTokens, "output token")}`;
  return usage.requests + usage.cached === 0 ? [] : [line];
}

export function formatText(report: Report): string {
  const lines = report.results.flatMap(resultLines);
  return [...lines, "", summaryLine(report.summary), ...usageLine(report.summary.usage), ""].join(
    "\n",
  );
}

export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function planLines(rule: PlanRule): string[] {
  const heading = `PLAN ${rule.id} (${rule.kind}, ${count(rule.files.length, "file")})`;
  return [heading, ...rule.files.map((file) => `  ${file}`)];
}

/** Every rule's files, then how many distinct files and model requests the run would take. */
export function formatPlanText(plan: Plan): string {
  const distinct = new Set(plan.rules.flatMap((rule) => rule.files)).size;
  const total = `${count(distinct, "file")}, ${count(plan.requests, "model request")}`;
  return [...plan.rules.flatMap(planLines), "", total, ""].join("\n");
}

export function formatPlanJson(plan: Plan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

/** `  path: expected fail, judged pass (noul 0.80): <reason>` for a fixture on the wrong side. */
function misclassifiedLine(entry: FixtureCase): string[] {
  const noul = entry.decision.noul.toFixed(2);
  return entry.actual === entry.expected
    ? []
    : [
        `  ${entry.path}: expected ${entry.expected}, judged ${entry.actual} (noul ${noul}): ${entry.reason}`,
      ];
}

function fixtureLines(rule: FixtureRule): string[] {
  const wrong = rule.cases.flatMap(misclassifiedLine);
  return [`${wrong.length === 0 ? "PASS" : "FAIL"} ${rule.id}`, ...wrong];
}

/** Every tested rule with its misclassified fixtures, then the totals. */
export function formatFixturesText(report: FixtureReport): string {
  const { cases, misclassified } = report.summary;
  const total = `${count(cases, "fixture")}, ${misclassified} misclassified`;
  return [...report.rules.flatMap(fixtureLines), "", total, ""].join("\n");
}

export function formatFixturesJson(report: FixtureReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
