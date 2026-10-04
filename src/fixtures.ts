import { filterOnly, judgesFor } from "./check.ts";
import type { Config, RuleOf } from "./config.ts";
import { CliError } from "./errors.ts";
import { readSourceFile, type SourceFile } from "./files.ts";
import type { Decision, Judge, Judges } from "./judge/judge.ts";
import { mapLimit } from "./pool.ts";
import type { RuleContext } from "./rules/deterministic.ts";
import { type Ask, askFor, requestFor } from "./rules/llm.ts";

export interface FixtureOptions {
  root: string;
  config: Config;
  /** Test only the rules with these ids. */
  only?: string[];
  /** `false` asks the model even when a cached verdict exists. */
  cache?: boolean;
  cacheDir?: string;
  judges: Judges;
}

/** Which side of the threshold a fixture is meant to land on, and did. */
export type Expected = "pass" | "fail";

export interface FixtureCase {
  path: string;
  expected: Expected;
  actual: Expected;
  decision: Decision;
  reason: string;
}

export interface FixtureRule {
  id: string;
  cases: FixtureCase[];
}

export interface FixtureReport {
  rules: FixtureRule[];
  summary: { cases: number; misclassified: number };
}

/** A `standard` rule that has fixtures to test. */
type Fixtured = RuleOf<"standard"> & { fixtures: NonNullable<RuleOf<"standard">["fixtures"]> };

function hasFixtures(rule: Config["rules"][number]): rule is Fixtured {
  return rule.kind === "standard" && rule.fixtures !== undefined;
}

/** Every fixture with the side it belongs on, pass fixtures first, in config order. */
function casesOf(rule: Fixtured): { path: string; expected: Expected }[] {
  return [
    ...rule.fixtures.pass.map((path) => ({ path, expected: "pass" as const })),
    ...rule.fixtures.fail.map((path) => ({ path, expected: "fail" as const })),
  ];
}

/** A fixture that cannot be read is a config error: the example the standard is tested against must exist. */
async function readFixture(rule: Fixtured, root: string, file: string): Promise<SourceFile> {
  const read = await readSourceFile(root, file).catch(() => undefined);
  if (read === undefined) {
    throw new CliError(`rule "${rule.id}": fixture ${file} is missing or binary`);
  }
  return read;
}

/** A fixture read and ready to judge. */
interface Loaded {
  path: string;
  expected: Expected;
  file: SourceFile;
}

/** Every fixture read before any is judged, so a missing one costs no request. */
async function loadFixtures(rule: Fixtured, root: string): Promise<Loaded[]> {
  return Promise.all(
    casesOf(rule).map(async (entry) => ({
      ...entry,
      file: await readFixture(rule, root, entry.path),
    })),
  );
}

/** Judges one fixture alone, as a `scope: file` request, and says which side it landed on. */
async function judgeFixture(
  rule: Fixtured,
  ask: Ask,
  judge: Judge,
  loaded: Loaded,
): Promise<FixtureCase> {
  const { decision, reason } = await judge.judge(requestFor(ask, [loaded.file]));
  const actual = decision.noul >= rule.threshold ? "pass" : "fail";
  return { path: loaded.path, expected: loaded.expected, actual, decision, reason };
}

async function testRule(
  rule: Fixtured,
  judge: Judge,
  ctx: RuleContext,
  concurrency: number,
): Promise<FixtureRule> {
  const ask = await askFor(rule, ctx);
  const loaded = await loadFixtures(rule, ctx.root);
  const cases = await mapLimit(loaded, concurrency, (entry) =>
    judgeFixture(rule, ask, judge, entry),
  );
  return { id: rule.id, cases };
}

function summarize(rules: FixtureRule[]): FixtureReport {
  const cases = rules.flatMap((rule) => rule.cases);
  const misclassified = cases.filter((entry) => entry.actual !== entry.expected).length;
  return { rules, summary: { cases: cases.length, misclassified } };
}

/**
 * Judges every fixture of every selected `standard` rule that has some,
 * through the same judges, context, cache, and threshold `check` would use,
 * and reports which fixtures landed on the wrong side. A provider error
 * propagates, since a fixture run has nothing else to report.
 */
export async function testFixtures(options: FixtureOptions): Promise<FixtureReport> {
  const rules = filterOnly(options.config.rules, options.only).filter(hasFixtures);
  const judges = (await judgesFor(rules, options)) ?? new Map<string, Judge>();
  const ctx: RuleContext = { root: options.root, ignore: options.config.ignore };
  const tested: FixtureRule[] = [];
  for (const rule of rules) {
    const judge = judges.get(rule.id);
    if (judge !== undefined) {
      tested.push(await testRule(rule, judge, ctx, options.config.llm.concurrency));
    }
  }
  return summarize(tested);
}

/** Exit code 1 when any fixture landed on the wrong side. */
export function exitCodeForFixtures(report: FixtureReport): 0 | 1 {
  return report.summary.misclassified === 0 ? 0 : 1;
}
