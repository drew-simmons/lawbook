import { expect, test, vi } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { run } from "../src/cli.ts";

/**
 * Runs the CLI with the color environment scrubbed, so a developer's
 * `CLICOLOR_FORCE` or `NO_COLOR` cannot change what a test sees.
 */
async function lawbook(...args: string[]) {
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

test("no arguments succeeds", async () => {
  expect((await lawbook()).code).toBe(0);
});

test("version prints package version", async () => {
  const result = await lawbook("--version");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(pkg.version);
});

test("help names the binary", async () => {
  const result = await lawbook("--help");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Usage: lawbook");
});

test("unknown flag exits two", async () => {
  const result = await lawbook("--no-such-flag");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("--no-such-flag");
});
