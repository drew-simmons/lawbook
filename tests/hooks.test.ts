import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import YAML from "yaml";

interface Hook {
  id: string;
  entry: string;
  language: string;
  pass_filenames: boolean;
}

const file = new URL("../.pre-commit-hooks.yaml", import.meta.url);

test("every pre-commit hook runs check on the staged files", async () => {
  const hooks = YAML.parse(await readFile(file, "utf8")) as Hook[];
  expect(hooks.map((hook) => hook.id)).toEqual(["lawbook", "lawbook-llm"]);
  for (const hook of hooks) {
    expect(hook.language).toBe("node");
    expect(hook.pass_filenames).toBe(true);
    expect(hook.entry).toMatch(/^lawbook check \. .*--files$/u);
  }
});
