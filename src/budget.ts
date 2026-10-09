import type { Config } from "./config.ts";
import { CliError } from "./errors.ts";
import { plan, type PlanOptions } from "./plan.ts";

/** The cap on model requests: the flag, else `llm.maxRequests`, else none. */
export function requestLimit(config: Config, flag: number | undefined): number | undefined {
  return flag ?? config.llm.maxRequests;
}

/** A whole number from the command line, or a usage error naming the flag. */
export function parseCount(flag: string, value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new CliError(`${flag} takes a whole number, not ${JSON.stringify(value)}`);
  }
  return count;
}

/**
 * Stops the run before any client is built when the plan would make more
 * model requests than `limit`. The count is the plan's: every selected file
 * of a `standard` rule but the empty ones, before the cache, the size and
 * suppression guards, or the whitespace and binary checks take any away, so
 * it is an upper bound.
 */
export async function assertWithinBudget(options: PlanOptions, limit: number): Promise<void> {
  const { requests } = await plan(options);
  if (requests > limit) {
    throw new CliError(
      `the run would make ${requests} model requests, over llm.maxRequests ${limit}; narrow files, pass --only, or raise the limit`,
    );
  }
}
