import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CliError, errorMessage } from "../errors.ts";
import { decisionSchema, type Judge, type JudgeRequest, NO_USAGE } from "./judge.ts";
import { SYSTEM_PROMPT } from "./messages.ts";

/** Where verdicts are cached, relative to the checked directory. */
export const DEFAULT_CACHE_DIR = "node_modules/.cache/lawbook";

const entrySchema = z.object({ decision: decisionSchema, reason: z.string() });

type Entry = z.infer<typeof entrySchema>;

/** Everything a verdict depends on, hashed: a change to any of it is a miss. */
export function cacheKey(model: string, request: JudgeRequest): string {
  const fields = {
    model,
    systemPrompt: SYSTEM_PROMPT,
    standard: request.standard,
    files: request.files,
    context: request.context ?? [],
  };
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** The cached entry, or undefined when there is none or it does not parse. */
async function readEntry(file: string): Promise<Entry | undefined> {
  try {
    return entrySchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined;
  }
}

async function writeEntry(dir: string, file: string, entry: Entry): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  } catch (error) {
    throw new CliError(
      `cannot write cache file ${file}: ${errorMessage(error)}; pass --no-cache or --cache-dir`,
    );
  }
}

/**
 * A judge that answers from `dir` when it can and asks `inner` otherwise,
 * storing what it learns. A cached verdict costs no tokens and says so.
 */
export function cachedJudge(inner: Judge, dir: string, model: string): Judge {
  return {
    async judge(request) {
      const file = path.join(dir, `${cacheKey(model, request)}.json`);
      const hit = await readEntry(file);
      if (hit !== undefined) {
        return { ...hit, usage: NO_USAGE, cached: true };
      }
      const verdict = await inner.judge(request);
      await writeEntry(dir, file, { decision: verdict.decision, reason: verdict.reason });
      return verdict;
    },
  };
}
