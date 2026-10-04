import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { lawbook, useTempDir, write } from "./helpers.ts";

const EXAMPLE = fileURLToPath(new URL("../examples/clean-code.lawbook.yaml", import.meta.url));
const PAGE = new URL("../docs/content/examples.mdx", import.meta.url);

const RULES = [
  "has-readme",
  "has-tests",
  "no-env-file",
  "no-orphan-todos",
  "names-reveal-intent",
  "functions-do-one-thing",
  "comments-say-why",
  "no-magic-values",
  "guard-clauses-over-nesting",
  "errors-are-handled-not-hidden",
  "dependencies-are-injected",
  "no-duplication",
  "no-speculative-generality",
  "deep-modules",
  "composition-over-inheritance",
  "outbound-calls-are-bounded",
  "tests-describe-behavior",
];

const dir = useTempDir();

test("the clean-code example loads and plans every rule", async () => {
  const result = await lawbook("check", dir(), "--config", EXAMPLE, "--dry-run");
  expect(result.code).toBe(0);
  for (const id of RULES) {
    expect(result.stdout).toContain(`PLAN ${id} (`);
  }
});

test("the clean-code example passes its deterministic rules on a minimal project", async () => {
  await write(dir(), "README.md", "# app\n");
  await write(dir(), "src/app.ts", "export const answer = 42; // TODO(#12) name it\n");
  await write(dir(), "tests/app.test.ts", "// FIXME see APP-7\n");
  const result = await lawbook("check", dir(), "--config", EXAMPLE, "--no-llm");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS no-orphan-todos\n");
  expect(result.stdout).toContain("SKIP tests-describe-behavior\n");
  expect(result.stdout).toContain("4 passed, 0 failed, 0 warned, 0 errored, 13 skipped\n");
});

test("the clean-code example fails a TODO that cites no issue", async () => {
  await write(dir(), "README.md", "# app\n");
  await write(
    dir(),
    "src/app.ts",
    "const todo = 1;\nexport const answer = 42; // TODO clean this up\n",
  );
  const result = await lawbook("check", dir(), "--config", EXAMPLE, "--no-llm");
  expect(result.code).toBe(1);
  expect(result.stdout).toContain(
    "FAIL no-orphan-todos\n  src/app.ts:2: link the comment to an issue, such as TODO(#123), or do it now\n",
  );
  expect(result.stdout).toContain("WARN has-tests\n");
});

test("the docs page quotes the clean-code example verbatim", async () => {
  const [example, page] = await Promise.all([readFile(EXAMPLE, "utf8"), readFile(PAGE, "utf8")]);
  expect(page).toContain(`\`\`\`yaml\n${example}\`\`\`\n`);
});
