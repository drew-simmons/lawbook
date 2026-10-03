import path from "node:path";
import type { RuleOf } from "../config.ts";
import { CliError, errorMessage } from "../errors.ts";
import {
  type FileSelection,
  splitLines,
  pathExists,
  readSourceFile,
  selectFiles,
  type SourceFile,
} from "../files.ts";
import { type Finding, type RuleResult, ruleResult } from "../result.ts";
import { parseSuppressions, suppressed } from "../suppress.ts";

/** What every rule needs to know about the directory under check. */
export interface RuleContext {
  root: string;
  ignore: string[];
  /** When set, `files` rules select only these root-relative paths. */
  candidates?: ReadonlySet<string>;
}

/** Patterns use the `m` and `u` flags, so `^` and `$` match at line ends. */
export function compilePattern(source: string): RegExp {
  try {
    return new RegExp(source, "mu");
  } catch (error) {
    throw new CliError(`invalid pattern ${JSON.stringify(source)}: ${errorMessage(error)}`);
  }
}

/** The paths a `files` rule selects: its globs minus the run's `ignore` and its own `exclude`. */
export function selectRuleFiles(rule: FileSelection, ctx: RuleContext): Promise<string[]> {
  return selectFiles(ctx.root, rule.files, [...ctx.ignore, ...rule.exclude], ctx.candidates);
}

/** The selected files as text; binary files are left out. */
export async function readSelected(rule: FileSelection, ctx: RuleContext): Promise<SourceFile[]> {
  const files = await selectRuleFiles(rule, ctx);
  const read = await Promise.all(files.map((file) => readSourceFile(ctx.root, file)));
  return read.filter((file) => file !== undefined);
}

/** One finding per matching line the file's markers do not suppress, carrying the rule's `message` or the trimmed line. */
function lineFindings(file: SourceFile, pattern: RegExp, rule: RuleOf<"forbid">): Finding[] {
  const marks = parseSuppressions(file.content);
  return splitLines(file.content).flatMap((line, index) =>
    pattern.test(line) && !suppressed(marks, rule.id, index + 1)
      ? [{ path: file.path, line: index + 1, message: rule.message ?? line.trim() }]
      : [],
  );
}

/** Whether the file matches the pattern, with CRLF line ends read as LF so `$` still anchors. */
function matches(pattern: RegExp, file: SourceFile): boolean {
  return pattern.test(splitLines(file.content).join("\n"));
}

export async function checkForbid(rule: RuleOf<"forbid">, ctx: RuleContext): Promise<RuleResult> {
  const pattern = compilePattern(rule.forbid);
  const files = await readSelected(rule, ctx);
  return ruleResult(
    rule,
    files.flatMap((file) => lineFindings(file, pattern, rule)),
  );
}

/** The rule's `message`, else what the file failed to match. */
function requireMessage(rule: RuleOf<"require">): string {
  return rule.message ?? `does not match /${rule.require}/`;
}

export async function checkRequire(rule: RuleOf<"require">, ctx: RuleContext): Promise<RuleResult> {
  const pattern = compilePattern(rule.require);
  const files = await readSelected(rule, ctx);
  const findings = files
    .filter(
      (file) => !matches(pattern, file) && !suppressed(parseSuppressions(file.content), rule.id),
    )
    .map((file) => ({ path: file.path, message: requireMessage(rule) }));
  return ruleResult(rule, findings);
}

export async function checkExists(rule: RuleOf<"exists">, ctx: RuleContext): Promise<RuleResult> {
  const exists = await pathExists(path.join(ctx.root, rule.exists));
  return ruleResult(rule, exists ? [] : [{ path: rule.exists, message: "missing" }]);
}

export async function checkAbsent(rule: RuleOf<"absent">, ctx: RuleContext): Promise<RuleResult> {
  const exists = await pathExists(path.join(ctx.root, rule.absent));
  return ruleResult(rule, exists ? [{ path: rule.absent, message: "exists" }] : []);
}
