import { expect, test } from "vitest";
import {
  type ChangedLines,
  contentLines,
  formatRanges,
  inRanges,
  isChanged,
  numberLines,
  parseHunks,
  rangesOf,
  unquotePath,
} from "../src/lines.ts";

const PATCH = [
  "diff --git a/mode.ts b/mode.ts",
  "old mode 100644",
  "new mode 100755",
  "diff --git a/new.ts b/new.ts",
  "new file mode 100644",
  "index 0000000..8ba3a16",
  "--- /dev/null",
  "+++ b/new.ts",
  "@@ -0,0 +1,2 @@",
  "+n",
  "+m",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "-a",
  "-b",
  "-c",
  "diff --git a/sp ace.ts b/sp ace.ts",
  "index de98044..a7bc997 100644",
  "--- a/sp ace.ts\t",
  "+++ b/sp ace.ts\t",
  "@@ -2 +2 @@ a",
  "-b",
  "+B",
  "@@ -3,0 +4 @@ c",
  "+d",
  "@@ -10,2 +11,3 @@ c",
  "-x",
  "-y",
  "+x",
  "+y",
  "+z",
  'diff --git "a/q\\"\\303\\244.ts" "b/q\\"\\303\\244.ts"',
  "index 587be6b..b77b4eb 100644",
  '--- "a/q\\"\\303\\244.ts"',
  '+++ "b/q\\"\\303\\244.ts"',
  "@@ -1,0 +2 @@ x",
  "+y",
  "",
].join("\n");

test("parseHunks lists the added and modified lines of each file on the new side", () => {
  expect(parseHunks(PATCH)).toEqual(
    new Map([
      ["mode.ts", []],
      ["new.ts", [{ start: 1, end: 2 }]],
      ["gone.ts", []],
      [
        "sp ace.ts",
        [
          { start: 2, end: 2 },
          { start: 4, end: 4 },
          { start: 11, end: 13 },
        ],
      ],
      ['q"ä.ts', [{ start: 2, end: 2 }]],
    ]),
  );
});

test("parseHunks of an empty patch lists nothing and ignores a hunk before any header", () => {
  expect(parseHunks("")).toEqual(new Map());
  expect(parseHunks("@@ -1 +1 @@\n+x\n")).toEqual(new Map());
});

test.each([
  ["plain", "a/b.ts", "a/b.ts"],
  ["a quote and a backslash", 'a\\"b\\\\c', 'a"b\\c'],
  ["named escapes", "a\\tb\\nc", "a\tb\nc"],
  ["octal UTF-8 bytes", "\\303\\244.ts", "ä.ts"],
  ["non-ASCII left plain", 'ä\\"b', 'ä"b'],
])("unquotePath reads %s", (_name, quoted, expected) => {
  expect(unquotePath(quoted)).toBe(expected);
});

test("formatRanges writes a range as start-end and a single line as itself", () => {
  expect(
    formatRanges([
      { start: 3, end: 5 },
      { start: 12, end: 12 },
    ]),
  ).toBe("3-5, 12");
  expect(formatRanges([])).toBe("");
});

test("inRanges is inclusive at both ends", () => {
  const ranges = [
    { start: 3, end: 5 },
    { start: 12, end: 12 },
  ];
  expect([2, 3, 5, 6, 12, 13].map((line) => inRanges(ranges, line))).toEqual([
    false,
    true,
    true,
    false,
    true,
    false,
  ]);
});

test("rangesOf covers the whole file for all and passes ranges through", () => {
  expect(rangesOf("all", "a\nb\nc\n")).toEqual([{ start: 1, end: 3 }]);
  expect(rangesOf([{ start: 2, end: 2 }], "a\nb\nc\n")).toEqual([{ start: 2, end: 2 }]);
});

test("contentLines does not count a final line end as another line", () => {
  expect(contentLines("a\nb\n")).toEqual(["a", "b"]);
  expect(contentLines("a\r\nb")).toEqual(["a", "b"]);
  expect(contentLines("a\n\n")).toEqual(["a", ""]);
});

test("numberLines pads the numbers to the widest and keeps blank lines", () => {
  const content = Array.from({ length: 10 }, (_line, index) => `l${index + 1}`).join("\n");
  expect(numberLines(`${content}\n`).split("\n")).toEqual([
    " 1 | l1",
    " 2 | l2",
    " 3 | l3",
    " 4 | l4",
    " 5 | l5",
    " 6 | l6",
    " 7 | l7",
    " 8 | l8",
    " 9 | l9",
    "10 | l10",
  ]);
  expect(numberLines("a\n\nb")).toBe("1 | a\n2 | \n3 | b");
});

test("isChanged is true without a map, for a file changed in full, and for one with ranges", () => {
  const changed = new Map<string, ChangedLines>([
    ["all.ts", "all"],
    ["some.ts", [{ start: 1, end: 1 }]],
    ["none.ts", []],
  ]);
  expect(isChanged(undefined, "none.ts")).toBe(true);
  expect(isChanged(changed, "all.ts")).toBe(true);
  expect(isChanged(changed, "some.ts")).toBe(true);
  expect(isChanged(changed, "none.ts")).toBe(false);
  expect(isChanged(changed, "unknown.ts")).toBe(false);
});
