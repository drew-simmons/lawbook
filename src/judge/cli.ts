import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { CliError } from "../errors.ts";

/**
 * Runs `command` with `args` in `cwd`, `input` on its stdin, and resolves
 * with its output once it exits 0. The claude-code adapter takes one as a
 * dependency; tests pass a fake, so no test spawns a real CLI.
 */
export type Exec = (
  command: string,
  args: string[],
  input: string,
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

/** 16 MiB: room for an event stream that echoes the whole prompt. */
const MAX_BUFFER = 16 * 1024 * 1024;

/** Spawns the command through `child_process.execFile`. */
export const defaultExec: Exec = (command, args, input, cwd) => {
  const running = execFileAsync(command, args, { cwd, maxBuffer: MAX_BUFFER });
  const { stdin } = running.child;
  // A child that exits before reading its input closes the pipe; its exit code says why.
  stdin?.on("error", () => undefined);
  stdin?.end(input);
  return running;
};

/** What `execFile` attaches to a rejection: `ENOENT` for a missing command, the exit code otherwise. */
const failureSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    stdout: z.string().default(""),
    stderr: z.string().default(""),
  })
  .loose();

/** The last non-empty line of the child's stderr, else its stdout: where a CLI puts its one-line reason. */
function lastLine(stderr: string, stdout: string): string | undefined {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.at(-1);
}

export type ExecFailure = z.infer<typeof failureSchema>;

/** The failure `execFile` rejected with, or undefined when `error` is not one. */
export function execFailure(error: unknown): ExecFailure | undefined {
  const failure = failureSchema.safeParse(error);
  return failure.success && failure.data.code !== undefined ? failure.data : undefined;
}

/**
 * A failed spawn becomes a one-line `CliError` naming the provider: the
 * command is missing, or it exited with an error. Anything else is a bug.
 */
export function translateExecError(error: unknown, provider: string, command: string): never {
  const failure = execFailure(error);
  if (failure === undefined) {
    throw error;
  }
  const { code, stdout, stderr } = failure;
  if (code === "ENOENT") {
    throw new CliError(`${provider}: ${command} is not installed or not on PATH`);
  }
  const reason = lastLine(stderr, stdout) ?? `exited with ${code}`;
  throw new CliError(`${provider}: ${reason}`);
}

/** Runs `work` in a fresh empty directory and removes it afterwards, whatever happens. */
export async function inScratchDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lawbook-judge-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
