import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, vi } from "vitest";
import { type Deps, run } from "../src/cli.ts";
import type { LlmConfig } from "../src/config.ts";
import type { UsageTotals } from "../src/result.ts";
import type { Judge, JudgeRequest, Judges, Usage, Verdict } from "../src/judge/judge.ts";

/** No test may reach a provider, so the default factories refuse to build one. */
export const noJudges: Judges = {
  "claude-code": () => Promise.reject(new Error("tests must inject a judge")),
  codex: () => Promise.reject(new Error("tests must inject a judge")),
  kiro: () => Promise.reject(new Error("tests must inject a judge")),
};

/**
 * Runs the CLI with the given dependencies and the environment scrubbed:
 * a developer's `CLICOLOR_FORCE` or `NO_COLOR` cannot change what a test
 * sees, and the git the CLI spawns ignores the machine's config.
 */
export async function lawbookWith(deps: Deps, ...args: string[]) {
  for (const name of ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"]) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_SYSTEM", "/dev/null");
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

const exec = promisify(execFile);

/** An environment for git that ignores the machine's config and identity. */
function gitEnv(dir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
}

/** Runs git in `dir` and returns its stdout. */
export async function gitIn(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", dir, ...args], { env: gitEnv(dir) });
  return stdout;
}

/** Makes `dir` a repository on `main` with everything in it committed. */
export async function gitRepo(dir: string): Promise<void> {
  await gitIn(dir, "init", "-q", "-b", "main");
  await gitIn(dir, "add", "-A");
  await gitIn(dir, "commit", "-q", "--allow-empty", "-m", "init");
}

export interface FakeJudge {
  judge: Judge;
  /** Every request, in order. */
  requests: JudgeRequest[];
  /** The config each provider factory received, in order. */
  built: LlmConfig[];
  /** Every provider builds this judge. */
  deps: Deps;
}

/** What every fake verdict costs, so usage sums are easy to predict. */
export const FAKE_USAGE: Usage = {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** A yes/no verdict, for tests that script the judge. */
export function noul(probability: number, reason: string): Verdict {
  return { decision: { type: "noul", noul: probability }, reason, usage: FAKE_USAGE };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The text line for `requests` fake verdicts from the provider and `cached` from the cache. */
export function usageLine(requests: number, cached = 0): string {
  return `${plural(requests, "request")} (${cached} cached), ${plural(requests * 10, "input token")}, ${plural(requests * 2, "output token")}\n`;
}

/** The totals `requests` fake verdicts add up to. */
export function usageTotals(requests: number): UsageTotals {
  return {
    inputTokens: requests * 10,
    outputTokens: requests * 2,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    requests,
    cached: 0,
  };
}

/** The paths a request carries, joined with commas: the key scripted verdicts use. */
export function requestKey(request: JudgeRequest): string {
  return request.files.map((file) => file.path).join(",");
}

/** A judge that answers from `verdicts` by request key and passes anything else. */
export function fakeJudge(verdicts: Record<string, Verdict> = {}): FakeJudge {
  const requests: JudgeRequest[] = [];
  const built: LlmConfig[] = [];
  const judge: Judge = {
    judge: async (request) => {
      requests.push(request);
      return verdicts[requestKey(request)] ?? noul(1, "fine");
    },
  };
  const factory = async (llm: LlmConfig) => {
    built.push(llm);
    return judge;
  };
  return {
    judge,
    requests,
    built,
    deps: {
      judges: { "claude-code": factory, codex: factory, kiro: factory },
    },
  };
}
