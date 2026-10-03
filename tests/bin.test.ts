import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };

const bin = fileURLToPath(new URL("../dist/bin.mjs", import.meta.url));

test("built binary prints package version", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [bin, "--version"]);
  expect(stdout.trim()).toBe(pkg.version);
});
