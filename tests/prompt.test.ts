import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { decisionOf, decisionSchema } from "../src/judge/judge.ts";
import {
  contextBlock,
  fileBlocks,
  requestLabel,
  SYSTEM_PROMPT,
  systemTexts,
} from "../src/judge/prompt.ts";

const REQUEST = {
  standard: "Errors are actionable",
  files: [{ path: "src/a.ts", content: "throw 1;\n" }],
};

test("decisionSchema is a Jev noul with a probability within 0 and 1", () => {
  expect(decisionSchema.parse({ type: "noul", noul: 0.98 })).toEqual({ type: "noul", noul: 0.98 });
  expect(decisionSchema.safeParse({ type: "noul", noul: 1.2 }).success).toBe(false);
  expect(decisionSchema.safeParse({ type: "noul", noul: -0.1 }).success).toBe(false);
  expect(decisionSchema.safeParse({ type: "choice", choice: "x" }).success).toBe(false);
});

test("decisionOf wraps a probability as a noul decision", () => {
  expect(decisionOf(0.2, "src/a.ts")).toEqual({ type: "noul", noul: 0.2 });
});

test.each([1.5, -0.1])("a probability of %s is a CliError naming the file", (noul) => {
  expect(() => decisionOf(noul, "src/a.ts")).toThrow(CliError);
  expect(() => decisionOf(noul, "src/a.ts")).toThrow(
    `the judge gave an out-of-range probability ${noul} for src/a.ts`,
  );
});

test("fileBlocks joins several files into blank-line separated blocks", () => {
  expect(
    fileBlocks([
      { path: "a.ts", content: "1;\n" },
      { path: "b.ts", content: "2;\n" },
    ]),
  ).toBe("File: a.ts\n\n1;\n\n\nFile: b.ts\n\n2;\n");
});

test("requestLabel names one file by path and several by count", () => {
  expect(requestLabel(REQUEST)).toBe("src/a.ts");
  expect(
    requestLabel({
      standard: "s",
      files: [
        { path: "a", content: "" },
        { path: "b", content: "" },
      ],
    }),
  ).toBe("2 files");
});

test("systemTexts is the system prompt, the standard, and the context block when there is one", () => {
  expect(systemTexts(REQUEST)).toEqual([SYSTEM_PROMPT, "Standard:\nErrors are actionable"]);
  expect(
    systemTexts({ ...REQUEST, context: [{ path: "docs/style.md", content: "# Style\n" }] }),
  ).toEqual([
    SYSTEM_PROMPT,
    "Standard:\nErrors are actionable",
    "Reference material. Use it to understand the standard; judge only the files in the message, not these.\n\nFile: docs/style.md\n\n# Style\n",
  ]);
});

test("contextBlock treats an empty context like none", () => {
  expect(contextBlock(undefined)).toEqual([]);
  expect(contextBlock([])).toEqual([]);
});
