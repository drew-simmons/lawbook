import { expect, test } from "vitest";
import { BINARY_PROBE_BYTES, isBinary, readSourceFile } from "../src/files.ts";
import { useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

test("isBinary finds a NUL within the probe and not beyond it", () => {
  const inside = Buffer.alloc(BINARY_PROBE_BYTES, "a");
  inside[BINARY_PROBE_BYTES - 1] = 0;
  const beyond = Buffer.concat([Buffer.alloc(BINARY_PROBE_BYTES, "a"), Buffer.from([0])]);
  expect(isBinary(inside)).toBe(true);
  expect(isBinary(beyond)).toBe(false);
  expect(isBinary(Buffer.alloc(0))).toBe(false);
});

test("readSourceFile returns text for a text file and nothing for a binary one", async () => {
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "b.bin", "pre\0post");
  expect(await readSourceFile(dir(), "a.ts")).toEqual({ path: "a.ts", content: "const a = 1;\n" });
  expect(await readSourceFile(dir(), "b.bin")).toBeUndefined();
});
