import type { RuleOf, Scope } from "../config.ts";
import { cliErrorMessage } from "../errors.ts";
import type { SourceFile } from "../files.ts";
import type { Judge, Verdict } from "../judge/judge.ts";
import { mapLimit } from "../pool.ts";
import {
  addTotals,
  type Finding,
  NO_TOTALS,
  type RuleResult,
  ruleResult,
  type Skipped,
  skipResult,
  type UsageTotals,
  withSkipped,
} from "../result.ts";
import { parseSuppressions, suppressed } from "../suppress.ts";
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

/** What one request produced: a verdict, or why there is none. `path` is the file for a per-file request. */
type Outcome = { path?: string; verdict: Verdict } | { path?: string; error: string };

/** An outcome that has a verdict. */
type Judged = { path?: string; verdict: Verdict };

/** The message for files a rule gave up on after a provider error. */
export const NOT_JUDGED = "not judged after an earlier error";

/** Set once a request fails, so the rest of the rule stops asking the provider. */
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

/** The skip entry for a file whose comments turn the rule off, else nothing. */
export function suppressionSkip(file: SourceFile, id: string): Skipped[] {
  return suppressed(parseSuppressions(file.content), id)
    ? [{ path: file.path, message: "suppressed by lawbook-disable-file" }]
    : [];
}

type Guard = (file: SourceFile, rule: RuleOf<"standard">, ctx: JudgeContext) => Skipped[];

/** Why a file is left out, by scope: a set is sized as a whole, so only suppression applies per file. */
const GUARDS: Record<Scope, Guard> = {
  file: (file, rule, ctx) =>
    [...suppressionSkip(file, rule.id), ...sizeSkip(file, ctx.maxBytes)].slice(0, 1),
  set: (file, rule) => suppressionSkip(file, rule.id),
};

/** Splits the files into those the judge sees and those left out, with the first reason that applies. */
function partition(files: SourceFile[], rule: RuleOf<"standard">, ctx: JudgeContext): Partition {
  const guarded = files.map((file) => ({ file, skipped: GUARDS[rule.scope](file, rule, ctx) }));
  return {
    judged: guarded.filter((entry) => entry.skipped.length === 0).map((entry) => entry.file),
    skipped: guarded.flatMap((entry) => entry.skipped),
  };
}

/** `{ path }` for a per-file outcome; nothing for a set, whose finding names no file. */
function at(path: string | undefined): { path?: string } {
  return path === undefined ? {} : { path };
}

/**
 * A `CliError` from the provider becomes the outcome and halts the rule:
 * requests not yet started are reported as not judged, while those in
 * flight finish. Any other error is a bug and propagates.
 */
async function judgeOnce(
  rule: RuleOf<"standard">,
  judge: Judge,
  files: SourceFile[],
  path: string | undefined,
  halt: Halt,
): Promise<Outcome> {
  if (halt.stopped) {
    return { ...at(path), error: NOT_JUDGED };
  }
  try {
    return { ...at(path), verdict: await judge.judge({ standard: rule.standard, files }) };
  } catch (error) {
    halt.stopped = true;
    return { ...at(path), error: cliErrorMessage(error) };
  }
}

/** A set that would not fit in one request errors without one; an empty set never asks. */
async function setOutcomes(
  rule: RuleOf<"standard">,
  judge: Judge,
  files: SourceFile[],
  ctx: JudgeContext,
  halt: Halt,
): Promise<Outcome[]> {
  const bytes = files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);
  if (bytes > ctx.maxBytes) {
    const error = `set of ${files.length} files is ${bytes} bytes, over llm.maxBytes ${ctx.maxBytes}`;
    return [{ error }];
  }
  return files.length === 0 ? [] : [await judgeOnce(rule, judge, files, undefined, halt)];
}

type Runner = (
  rule: RuleOf<"standard">,
  judge: Judge,
  files: SourceFile[],
  ctx: JudgeContext,
  halt: Halt,
) => Promise<Outcome[]>;

/** Per file, up to `concurrency` requests at once in path order; per set, one request. */
const RUN: Record<Scope, Runner> = {
  file: (rule, judge, files, ctx, halt) =>
    mapLimit(files, ctx.concurrency, (file) => judgeOnce(rule, judge, [file], file.path, halt)),
  set: setOutcomes,
};

/** How judged outcomes appear on the result: a map by path, or the one decision. */
const FINISH: Record<Scope, (judged: Judged[]) => Partial<RuleResult>> = {
  file: (judged) => ({
    decisions: Object.fromEntries(
      judged.map(({ path, verdict }) => [path ?? "", verdict.decision]),
    ),
  }),
  set: (judged) => ({ decision: judged[0]?.verdict.decision }),
};

/** The error as a finding, or a finding when the probability falls below the threshold. */
function outcomeFindings(outcome: Outcome, threshold: number): Finding[] {
  if ("error" in outcome) {
    return [{ ...at(outcome.path), message: outcome.error }];
  }
  const { decision, reason } = outcome.verdict;
  return decision.noul < threshold ? [{ ...at(outcome.path), message: reason, decision }] : [];
}

/** One verdict's share of the totals: a provider call, or a cache hit that cost nothing. */
function usageOf(verdict: Verdict): UsageTotals {
  const hit = verdict.cached === true ? 1 : 0;
  return { ...verdict.usage, requests: 1 - hit, cached: hit };
}

/** `error` when any request has no verdict; else the findings decide, as for any rule. */
function judgedResult(
  rule: RuleOf<"standard">,
  outcomes: Outcome[],
  skipped: Skipped[],
): RuleResult {
  const findings = outcomes.flatMap((outcome) => outcomeFindings(outcome, rule.threshold));
  const judged = outcomes.flatMap((outcome) => ("verdict" in outcome ? [outcome] : []));
  const usage = judged.reduce(
    (total, outcome) => addTotals(total, usageOf(outcome.verdict)),
    NO_TOTALS,
  );
  const shaped = { ...ruleResult(rule, findings), ...FINISH[rule.scope](judged), usage };
  const result = withSkipped(shaped, skipped);
  return judged.length === outcomes.length ? result : { ...result, status: "error" };
}

/** The outcomes of the files the guards let through, run the way the rule's scope says. */
async function judgeFiles(
  rule: RuleOf<"standard">,
  judge: Judge,
  ctx: JudgeContext,
): Promise<RuleResult> {
  const { judged, skipped } = partition(await readSelected(rule, ctx), rule, ctx);
  const halt: Halt = { stopped: false };
  const outcomes = await RUN[rule.scope](rule, judge, judged, ctx, halt);
  return judgedResult(rule, outcomes, skipped);
}

export async function checkStandard(
  rule: RuleOf<"standard">,
  ctx: JudgeContext,
): Promise<RuleResult> {
  return ctx.judge === undefined ? skipResult(rule) : judgeFiles(rule, ctx.judge, ctx);
}
