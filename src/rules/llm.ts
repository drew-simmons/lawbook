import type { RuleOf } from "../config.ts";
import { cliErrorMessage } from "../errors.ts";
import type { SourceFile } from "../files.ts";
import type { Judge, Verdict } from "../judge/judge.ts";
import { mapLimit } from "../pool.ts";
import {
  type Finding,
  type RuleResult,
  ruleResult,
  type Skipped,
  skipResult,
  withSkipped,
} from "../result.ts";
import { readSelected, type RuleContext } from "./deterministic.ts";

/** `judge` is absent when the run skips LLM rules. */
export interface JudgeContext extends RuleContext {
  judge?: Judge;
  /** How many files the judge sees at once. */
  concurrency: number;
  /** The largest file, in bytes, the judge is sent. */
  maxBytes: number;
}

interface Partition {
  judged: SourceFile[];
  skipped: Skipped[];
}

/** What judging one file produced: a verdict, or why there is none. */
type Outcome = { file: SourceFile; verdict: Verdict } | { file: SourceFile; error: string };

/** The message for files a rule gave up on after a provider error. */
export const NOT_JUDGED = "not judged after an earlier error";

/** Set once a file fails, so the rest of the rule stops asking the provider. */
interface Halt {
  stopped: boolean;
}

/** The skip entry for a file too large to send, else nothing. */
export function sizeSkip(file: SourceFile, maxBytes: number): Skipped[] {
  const bytes = Buffer.byteLength(file.content);
  return bytes > maxBytes
    ? [{ path: file.path, message: `skipped, ${bytes} bytes over llm.maxBytes ${maxBytes}` }]
    : [];
}

/** Splits the files into those the judge sees and those left out, with the reason. */
function partition(files: SourceFile[], ctx: JudgeContext): Partition {
  const sized = files.map((file) => ({ file, skipped: sizeSkip(file, ctx.maxBytes) }));
  return {
    judged: sized.filter((entry) => entry.skipped.length === 0).map((entry) => entry.file),
    skipped: sized.flatMap((entry) => entry.skipped),
  };
}

/** A finding when the probability falls below the rule's threshold, else nothing. */
function findingFor(file: SourceFile, verdict: Verdict, threshold: number): Finding[] {
  return verdict.decision.noul < threshold
    ? [{ path: file.path, message: verdict.reason, decision: verdict.decision }]
    : [];
}

/**
 * A `CliError` from the provider becomes the file's outcome and halts the
 * rule: files not yet started are reported as not judged, while those in
 * flight finish. Any other error is a bug and propagates.
 */
async function judgeOne(
  rule: RuleOf<"standard">,
  judge: Judge,
  file: SourceFile,
  halt: Halt,
): Promise<Outcome> {
  if (halt.stopped) {
    return { file, error: NOT_JUDGED };
  }
  try {
    return { file, verdict: await judge.judge({ standard: rule.standard, ...file }) };
  } catch (error) {
    halt.stopped = true;
    return { file, error: cliErrorMessage(error) };
  }
}

function outcomeFindings(outcome: Outcome, threshold: number): Finding[] {
  return "verdict" in outcome
    ? findingFor(outcome.file, outcome.verdict, threshold)
    : [{ path: outcome.file.path, message: outcome.error }];
}

/** `error` when any file has no verdict; else the findings decide, as for any rule. */
function judgedResult(
  rule: RuleOf<"standard">,
  outcomes: Outcome[],
  skipped: Skipped[],
): RuleResult {
  const findings = outcomes.flatMap((outcome) => outcomeFindings(outcome, rule.threshold));
  const judged = outcomes.flatMap((outcome) => ("verdict" in outcome ? [outcome] : []));
  const decisions = Object.fromEntries(
    judged.map(({ file, verdict }) => [file.path, verdict.decision]),
  );
  const result = withSkipped({ ...ruleResult(rule, findings), decisions }, skipped);
  return judged.length === outcomes.length ? result : { ...result, status: "error" };
}

/** One outcome per selected file, up to `concurrency` at a time, in path order. */
async function judgeFiles(
  rule: RuleOf<"standard">,
  judge: Judge,
  ctx: JudgeContext,
): Promise<RuleResult> {
  const { judged, skipped } = partition(await readSelected(rule, ctx), ctx);
  const halt: Halt = { stopped: false };
  const outcomes = await mapLimit(judged, ctx.concurrency, (file) =>
    judgeOne(rule, judge, file, halt),
  );
  return judgedResult(rule, outcomes, skipped);
}

export async function checkStandard(
  rule: RuleOf<"standard">,
  ctx: JudgeContext,
): Promise<RuleResult> {
  return ctx.judge === undefined ? skipResult(rule) : judgeFiles(rule, ctx.judge, ctx);
}
