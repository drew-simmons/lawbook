import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { run } from "../src/cli.ts";

/**
 * Runs the CLI with the color environment scrubbed, so a developer's
 * `CLICOLOR_FORCE` or `NO_COLOR` cannot change what a test sees.
 */
export async function lawbook(...args: string[]) {
  for (const name of ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"]) {
    vi.stubEnv(name, undefined);
  }
  let stdout = "";
  let stderr = "";
  const code = await run(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  vi.unstubAllEnvs();
  return { code, stdout, stderr };
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
