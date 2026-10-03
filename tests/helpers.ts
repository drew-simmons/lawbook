import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { type Deps, run } from "../src/cli.ts";
import type { LlmConfig } from "../src/config.ts";
import type { Judge, JudgeRequest, Judges, Verdict } from "../src/judge/judge.ts";

/** No test may reach a provider, so the default factories refuse to build one. */
export const noJudges: Judges = {
  bedrock: () => Promise.reject(new Error("tests must inject a judge")),
  anthropic: () => Promise.reject(new Error("tests must inject a judge")),
};

/**
 * Runs the CLI with the given dependencies and the color environment
 * scrubbed, so a developer's `CLICOLOR_FORCE` or `NO_COLOR` cannot change
 * what a test sees.
 */
export async function lawbookWith(deps: Deps, ...args: string[]) {
  for (const name of ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"]) {
    vi.stubEnv(name, undefined);
  }
  let stdout = "";
  let stderr = "";
  const code = await run(
    args,
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    deps,
  );
  vi.unstubAllEnvs();
  return { code, stdout, stderr };
}

/** Runs the CLI with no judge available. */
export function lawbook(...args: string[]) {
  return lawbookWith({ judges: noJudges }, ...args);
}

/**
 * A fresh empty directory for each test in the file. The returned function
 * gives the current one; call it inside a test, not at module level.
 */
export function useTempDir(): () => string {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lawbook-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return () => dir;
}

/** Writes `text` to `relative` under `dir`, creating parent directories. */
export async function write(dir: string, relative: string, text: string): Promise<void> {
  const file = path.join(dir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

export interface FakeJudge {
  judge: Judge;
  /** Every request, in order. */
  requests: JudgeRequest[];
  /** The config each provider factory received, in order. */
  built: LlmConfig[];
  /** Both providers build this judge. */
  deps: Deps;
}

/** A yes/no verdict, for tests that script the judge. */
export function noul(probability: number, reason: string): Verdict {
  return { decision: { type: "noul", noul: probability }, reason };
}

/** A judge that answers from `verdicts` by path and passes anything else. */
export function fakeJudge(verdicts: Record<string, Verdict> = {}): FakeJudge {
  const requests: JudgeRequest[] = [];
  const built: LlmConfig[] = [];
  const judge: Judge = {
    judge: async (request) => {
      requests.push(request);
      return verdicts[request.path] ?? noul(1, "fine");
    },
  };
  const factory = async (llm: LlmConfig) => {
    built.push(llm);
    return judge;
  };
  return { judge, requests, built, deps: { judges: { bedrock: factory, anthropic: factory } } };
}
