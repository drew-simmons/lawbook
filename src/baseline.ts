import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { RuleKind } from "./config.ts";
import { CliError, errorMessage } from "./errors.ts";
import { type Finding, type Report, type RuleResult, restatus, summarize } from "./result.ts";

/** What identifies a finding across runs. Line numbers drift, so they are left out. */
const entrySchema = z
  .object({
    rule: z.string(),
    path: z.string().optional(),
    message: z.string().optional(),
    /** How many identical findings the baseline holds. */
    count: z.int().min(1),
  })
  .strict();

export const baselineSchema = z
  .object({ version: z.literal(1), findings: z.array(entrySchema) })
  .strict();

export type Baseline = z.infer<typeof baselineSchema>;
export type BaselineEntry = Baseline["findings"][number];

type Identity = Omit<BaselineEntry, "count">;

/**
 * What each kind's finding is keyed by. `forbid` includes the message, since
 * one file can match on several lines; the other deterministic kinds derive
 * their message from the rule. A `standard` finding is keyed by its path, as
 * the model's reason varies between runs, and only when it carries a
 * decision: a provider error is never baselined.
 */
const KEYS: Record<RuleKind, (rule: string, finding: Finding) => Identity | undefined> = {
  forbid: (rule, finding) => ({ rule, path: finding.path, message: finding.message }),
  require: (rule, finding) => ({ rule, path: finding.path }),
  exists: (rule, finding) => ({ rule, path: finding.path }),
  absent: (rule, finding) => ({ rule, path: finding.path }),
  standard: (rule, finding) =>
    finding.decision === undefined ? undefined : { rule, path: finding.path },
};

function keyOf(identity: Identity): string {
  return JSON.stringify([identity.rule, identity.path ?? null, identity.message ?? null]);
}

/** Every finding's identity in the report, keyed, with a count. */
function tally(report: Report): Map<string, BaselineEntry> {
  const entries = new Map<string, BaselineEntry>();
  for (const result of report.results) {
    for (const finding of result.findings) {
      const identity = KEYS[result.kind](result.id, finding);
      if (identity !== undefined) {
        const key = keyOf(identity);
        const known = entries.get(key);
        entries.set(
          key,
          known === undefined ? { ...identity, count: 1 } : { ...known, count: known.count + 1 },
        );
      }
    }
  }
  return entries;
}

/** Sorted so that two runs over the same findings write the same file. */
function byIdentity(a: BaselineEntry, b: BaselineEntry): number {
  return keyOf(a).localeCompare(keyOf(b));
}

/** The report's findings as a baseline, sorted for stable diffs. */
export function buildBaseline(report: Report): Baseline {
  return { version: 1, findings: [...tally(report).values()].toSorted(byIdentity) };
}

/** Whether the finding is in the baseline, consuming one count when it is. */
function consume(remaining: Map<string, number>, result: RuleResult, finding: Finding): boolean {
  const identity = KEYS[result.kind](result.id, finding);
  const key = identity === undefined ? undefined : keyOf(identity);
  const left = key === undefined ? 0 : (remaining.get(key) ?? 0);
  if (left === 0 || key === undefined) {
    return false;
  }
  remaining.set(key, left - 1);
  return true;
}

/** The result without its baselined findings, counting how many were dropped. */
function withoutBaselined(result: RuleResult, remaining: Map<string, number>): RuleResult {
  const findings = result.findings.filter((finding) => !consume(remaining, result, finding));
  const baselined = result.findings.length - findings.length;
  const kept = restatus(result, findings);
  return baselined === 0 ? kept : { ...kept, baselined };
}

/** The report with every baselined finding dropped and the summary recomputed. */
export function applyBaseline(report: Report, baseline: Baseline): Report {
  const remaining = new Map(baseline.findings.map((entry) => [keyOf(entry), entry.count]));
  return summarize(report.results.map((result) => withoutBaselined(result, remaining)));
}

export async function readBaseline(file: string): Promise<Baseline> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new CliError(`cannot read baseline ${file}: ${errorMessage(error)}`);
  }
  return parseBaseline(file, text);
}

export function parseBaseline(file: string, text: string): Baseline {
  const parsed = baselineSchema.safeParse(parseJson(file, text));
  if (!parsed.success) {
    throw new CliError(`${file}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function parseJson(file: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`${file}: ${errorMessage(error)}`);
  }
}

export async function writeBaseline(file: string, baseline: Baseline): Promise<void> {
  try {
    await writeFile(file, `${JSON.stringify(baseline, null, 2)}\n`);
  } catch (error) {
    throw new CliError(`cannot write baseline ${file}: ${errorMessage(error)}`);
  }
}
