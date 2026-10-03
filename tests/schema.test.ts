import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import YAML from "yaml";
import { TEMPLATE } from "../src/init.ts";
import { configJsonSchema, formatSchema, SCHEMA_URL } from "../src/schema.ts";
import { lawbook } from "./helpers.ts";

interface ObjectSchema {
  properties: Record<string, unknown>;
  additionalProperties?: boolean;
  required?: string[];
}

const schema = configJsonSchema() as ObjectSchema & {
  $schema: string;
  $id: string;
  properties: {
    version: { const: number };
    llm: ObjectSchema;
    rules: { items: { anyOf: ObjectSchema[] } };
  };
};

test("the schema is draft 2020-12, names its URL, and rejects unknown keys", () => {
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect(schema.$id).toBe(SCHEMA_URL);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(["version", "rules"]);
  expect(schema.properties.version.const).toBe(1);
});

test("the schema describes every llm key and every rule kind", () => {
  expect(Object.keys(schema.properties.llm.properties).toSorted()).toEqual([
    "baseUrl",
    "cache",
    "concurrency",
    "maxBytes",
    "maxRequests",
    "model",
    "provider",
    "region",
  ]);
  const kinds = schema.properties.rules.items.anyOf.map((branch) =>
    ["forbid", "require", "exists", "absent", "standard"].find((kind) => kind in branch.properties),
  );
  expect(kinds).toEqual(["forbid", "require", "exists", "absent", "standard"]);
  const standard = schema.properties.rules.items.anyOf[4];
  expect(Object.keys(standard?.properties ?? {})).toEqual(
    expect.arrayContaining(
      ["threshold", "scope", "llm", "context", "fixtures", "message"].filter(
        (key) => key !== "message",
      ),
    ),
  );
  expect(standard?.properties).not.toHaveProperty("message");
});

test("the schema drops the safe-integer ceiling zod adds to whole numbers", () => {
  expect(JSON.stringify(schema)).not.toContain(String(Number.MAX_SAFE_INTEGER));
  expect(schema.properties.llm.properties.concurrency).toMatchObject({
    type: "integer",
    minimum: 1,
  });
});

test("lawbook schema prints the schema", async () => {
  const result = await lawbook("schema");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(formatSchema());
  expect(JSON.parse(result.stdout)).toEqual(configJsonSchema());
});

test("the committed lawbook.schema.json matches the command, so pnpm run schema was run", async () => {
  const committed = await readFile(new URL("../lawbook.schema.json", import.meta.url), "utf8");
  expect(committed).toBe(formatSchema());
});

/** The keys a rule in the template uses are all known to some rule branch of the schema. */
function knownRuleKeys(rule: Record<string, unknown>): boolean {
  return schema.properties.rules.items.anyOf.some((branch) =>
    Object.keys(rule).every((key) => key in branch.properties),
  );
}

test("every key the init template uses is in the schema", () => {
  const config = YAML.parse(TEMPLATE) as Record<string, unknown> & {
    rules: Record<string, unknown>[];
  };
  for (const key of Object.keys(config)) {
    expect(schema.properties).toHaveProperty(key);
  }
  for (const rule of config.rules) {
    expect(knownRuleKeys(rule)).toBe(true);
  }
  expect(TEMPLATE.startsWith(`# yaml-language-server: $schema=${SCHEMA_URL}\n`)).toBe(true);
});
