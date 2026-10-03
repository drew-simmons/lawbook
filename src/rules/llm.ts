import type { Rule, RuleOf } from "../config.ts";
import type { Judge } from "../judge/judge.ts";
import { type Finding, type RuleResult, ruleResult } from "../result.ts";
import { readSelected, type RuleContext } from "./deterministic.ts";

/** `judge` is absent when the run skips LLM rules. */
export interface JudgeContext extends RuleContext {
  judge?: Judge;
}

export function skipResult(rule: Rule): RuleResult {
  return { id: rule.id, kind: rule.kind, status: "skip", findings: [] };
}

async function judgeFiles(
  rule: RuleOf<"standard">,
  judge: Judge,
  ctx: RuleContext,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const file of await readSelected(rule.files, ctx)) {
    const verdict = await judge.judge({ standard: rule.standard, ...file });
    if (!verdict.pass) {
      findings.push({ path: file.path, message: verdict.reason });
    }
  }
  return findings;
}

/** One verdict per selected file, in order; a failing file is a finding. */
export async function checkStandard(
  rule: RuleOf<"standard">,
  ctx: JudgeContext,
): Promise<RuleResult> {
  return ctx.judge === undefined
    ? skipResult(rule)
    : ruleResult(rule, await judgeFiles(rule, ctx.judge, ctx));
}
