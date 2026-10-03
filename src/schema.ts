import { z } from "zod";
import { configSchema } from "./config.ts";

/** Where the committed schema lives, for `$schema` comments in editors. */
export const SCHEMA_URL =
  "https://raw.githubusercontent.com/drew-simmons/lawbook/main/lawbook.schema.json";

type Json = Record<string, unknown>;

/** `z.int()` adds the safe-integer ceiling as `maximum`, which only clutters an editor's hint. */
function withoutSafeIntegerBounds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutSafeIntegerBounds);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const entries = Object.entries(value).filter(
    ([key, entry]) => !(key === "maximum" && entry === Number.MAX_SAFE_INTEGER),
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key, withoutSafeIntegerBounds(entry)]));
}

/**
 * The config file's JSON Schema, drawn from the zod schema's input side, so
 * it describes what a user writes: defaults are optional, transforms are
 * invisible, and unknown keys are rejected where the config rejects them.
 */
export function configJsonSchema(): Json {
  const { $schema, ...rest } = z.toJSONSchema(configSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  return {
    $schema,
    $id: SCHEMA_URL,
    title: "lawbook.yaml",
    description: "The rules lawbook checks a directory against.",
    ...(withoutSafeIntegerBounds(rest) as Json),
  };
}

export function formatSchema(): string {
  return `${JSON.stringify(configJsonSchema(), null, 2)}\n`;
}
