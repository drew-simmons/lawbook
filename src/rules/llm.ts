import type { Rule, RuleOf } from "../config.ts";
import type { SourceFile } from "../files.ts";
import type { Judge, Verdict } from "../judge/judge.ts";
import { mapLimit } from "../pool.ts";
import { type Finding, type RuleResult, ruleResult } from "../result.ts";
import { readSelected, type RuleContext } from "./deterministic.ts";

/** `judge` is absent when the run skips LLM rules. */
export interface JudgeContext extends RuleContext {
  judge?: Judge;
  /** How many files the judge sees at once. */
  concurrency: number;
}

interface Judged {
  file: SourceFile;
  verdict: Verdict;
}

export function skipResult(rule: Rule): RuleResult {
  return { id: rule.id, kind: rule.kind, level: rule.level, status: "skip", findings: [] };
}

/** A finding when the probability falls below the rule's threshold, else nothing. */
function findingFor(file: SourceFile, verdict: Verdict, threshold: number): Finding[] {
  return verdict.decision.noul < threshold
    ? [{ path: file.path, message: verdict.reason, decision: verdict.decision }]
    : [];
}

/**
 * One decision per selected file, up to `concurrency` at a time. Results
 * stay in path order, so a file under the threshold is a finding in order.
 */
async function judgeFiles(
  rule: RuleOf<"standard">,
  judge: Judge,
  ctx: JudgeContext,
): Promise<RuleResult> {
  const files = await readSelected(rule.files, ctx);
  const judged = await mapLimit(files, ctx.concurrency, async (file): Promise<Judged> => ({
    file,
    verdict: await judge.judge({ standard: rule.standard, ...file }),
  }));
  const decisions = Object.fromEntries(
    judged.map(({ file, verdict }) => [file.path, verdict.decision]),
  );
  const findings = judged.flatMap(({ file, verdict }) => findingFor(file, verdict, rule.threshold));
  return { ...ruleResult(rule, findings), decisions };
}

export async function checkStandard(
  rule: RuleOf<"standard">,
  ctx: JudgeContext,
): Promise<RuleResult> {
  return ctx.judge === undefined ? skipResult(rule) : judgeFiles(rule, ctx.judge, ctx);
}
