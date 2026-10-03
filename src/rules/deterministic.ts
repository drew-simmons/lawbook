import path from "node:path";
import type { RuleOf } from "../config.ts";
import { CliError, errorMessage } from "../errors.ts";
import { pathExists, readSourceFile, selectFiles, type SourceFile } from "../files.ts";
import { type Finding, type RuleResult, ruleResult } from "../result.ts";

/** What every rule needs to know about the directory under check. */
export interface RuleContext {
  root: string;
  ignore: string[];
}

/** Patterns use the `m` and `u` flags, so `^` and `$` match at line ends. */
export function compilePattern(source: string): RegExp {
  try {
    return new RegExp(source, "mu");
  } catch (error) {
    throw new CliError(`invalid pattern ${JSON.stringify(source)}: ${errorMessage(error)}`);
  }
}

export async function readSelected(patterns: string[], ctx: RuleContext): Promise<SourceFile[]> {
  const files = await selectFiles(ctx.root, patterns, ctx.ignore);
  return Promise.all(files.map((file) => readSourceFile(ctx.root, file)));
}

/** One finding per line that matches, carrying the trimmed line. */
function lineFindings(file: SourceFile, pattern: RegExp): Finding[] {
  return file.content
    .split("\n")
    .flatMap((line, index) =>
      pattern.test(line) ? [{ path: file.path, line: index + 1, message: line.trim() }] : [],
    );
}

export async function checkForbid(rule: RuleOf<"forbid">, ctx: RuleContext): Promise<RuleResult> {
  const pattern = compilePattern(rule.forbid);
  const files = await readSelected(rule.files, ctx);
  return ruleResult(
    rule,
    files.flatMap((file) => lineFindings(file, pattern)),
  );
}

export async function checkRequire(rule: RuleOf<"require">, ctx: RuleContext): Promise<RuleResult> {
  const pattern = compilePattern(rule.require);
  const files = await readSelected(rule.files, ctx);
  const findings = files
    .filter((file) => !pattern.test(file.content))
    .map((file) => ({ path: file.path, message: `does not match /${rule.require}/` }));
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
