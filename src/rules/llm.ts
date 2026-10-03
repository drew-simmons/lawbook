import type { Rule, RuleOf } from "../config.ts";
import type { SourceFile } from "../files.ts";
import type { Decision, Judge, Verdict } from "../judge/judge.ts";
import { type Finding, type RuleResult, ruleResult } from "../result.ts";
import { readSelected, type RuleContext } from "./deterministic.ts";

/** `judge` is absent when the run skips LLM rules. */
export interface JudgeContext extends RuleContext {
  judge?: Judge;
}

export function skipResult(rule: Rule): RuleResult {
  return { id: rule.id, kind: rule.kind, status: "skip", findings: [] };
}

/** A finding when the probability falls below the rule's threshold, else nothing. */
function findingFor(file: SourceFile, verdict: Verdict, threshold: number): Finding[] {
  return verdict.decision.noul < threshold
    ? [{ path: file.path, message: verdict.reason, decision: verdict.decision }]
    : [];
}

/** One decision per selected file, in order; a file under the threshold is a finding. */
async function judgeFiles(
  rule: RuleOf<"standard">,
  judge: Judge,
  ctx: RuleContext,
): Promise<RuleResult> {
  const findings: Finding[] = [];
  const decisions: Record<string, Decision> = {};
  for (const file of await readSelected(rule.files, ctx)) {
    const verdict = await judge.judge({ standard: rule.standard, ...file });
    decisions[file.path] = verdict.decision;
    findings.push(...findingFor(file, verdict, rule.threshold));
  }
  return { ...ruleResult(rule, findings), decisions };
}

export async function checkStandard(
  rule: RuleOf<"standard">,
  ctx: JudgeContext,
): Promise<RuleResult> {
  return ctx.judge === undefined ? skipResult(rule) : judgeFiles(rule, ctx.judge, ctx);
}
