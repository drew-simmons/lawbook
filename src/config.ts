import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { CliError, errorMessage } from "./errors.ts";
import { pathExists } from "./files.ts";

/** Config file names `check` and `init` look for, in order of preference. */
export const CONFIG_NAMES = ["lawbook.yaml", "lawbook.yml", "lawbook.json"];

/** Paths no rule looks at unless the config sets its own `ignore`. */
export const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**"];

/** How a rule's findings count: `error` fails the run, `warn` only reports them. */
export const LEVELS = ["error", "warn"] as const;

export type Level = (typeof LEVELS)[number];

const text = z.string().min(1);
const base = {
  id: text,
  description: z.string().optional(),
  level: z.enum(LEVELS).default("error"),
};
const files = z.array(text).min(1);
const probability = z.number().min(0).max(1);

const forbidRule = z
  .object({ ...base, files, forbid: text })
  .strict()
  .transform((rule) => ({ kind: "forbid" as const, ...rule }));
const requireRule = z
  .object({ ...base, files, require: text })
  .strict()
  .transform((rule) => ({ kind: "require" as const, ...rule }));
const existsRule = z
  .object({ ...base, exists: text })
  .strict()
  .transform((rule) => ({ kind: "exists" as const, ...rule }));
const absentRule = z
  .object({ ...base, absent: text })
  .strict()
  .transform((rule) => ({ kind: "absent" as const, ...rule }));
// A `standard` rule is a yes/no question; a file fails below `threshold`.
const standardRule = z
  .object({ ...base, files, standard: text, threshold: probability.default(0.5) })
  .strict()
  .transform((rule) => ({ kind: "standard" as const, ...rule }));

export const ruleSchema = z.union([forbidRule, requireRule, existsRule, absentRule, standardRule]);

export type Rule = z.infer<typeof ruleSchema>;
export type RuleKind = Rule["kind"];
export type RuleOf<K extends RuleKind> = Extract<Rule, { kind: K }>;

/** Ids that appear more than once, in order of their second appearance. */
function duplicateIds(rules: { id: string }[]): string[] {
  const seen = new Set<string>();
  return rules.map((rule) => rule.id).filter((id) => seen.size === seen.add(id).size);
}

export const PROVIDERS = ["bedrock", "anthropic"] as const;

export type Provider = (typeof PROVIDERS)[number];

/** The model each provider uses when the config names none. */
export const DEFAULT_MODELS: Record<Provider, string> = {
  bedrock: "anthropic.claude-opus-5-5",
  anthropic: "claude-opus-5-5",
};

const llmSchema = z
  .object({
    provider: z.enum(PROVIDERS).default("bedrock"),
    model: text.optional(),
    region: text.optional(),
    /** How many files a `standard` rule judges at once. */
    concurrency: z.int().min(1).default(4),
  })
  .strict()
  .check((ctx) => {
    if (ctx.value.provider === "anthropic" && ctx.value.region !== undefined) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        path: ["region"],
        message: "region applies to the bedrock provider only",
      });
    }
  })
  .transform((llm) => ({ ...llm, model: llm.model ?? DEFAULT_MODELS[llm.provider] }));

export type LlmConfig = z.infer<typeof llmSchema>;

export const configSchema = z
  .object({
    version: z.literal(1),
    ignore: z.array(z.string()).default(DEFAULT_IGNORE),
    // `prefault` runs the defaults through the schema, so `model` gets filled in.
    llm: llmSchema.prefault({}),
    rules: z.array(ruleSchema),
  })
  .strict()
  .check((ctx) => {
    for (const id of duplicateIds(ctx.value.rules)) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        path: ["rules"],
        message: `duplicate rule id "${id}"`,
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

/** The config files present in `root`, in order of preference. */
export async function existingConfigFiles(root: string): Promise<string[]> {
  const candidates = CONFIG_NAMES.map((name) => path.join(root, name));
  const present = await Promise.all(candidates.map(pathExists));
  return candidates.filter((_, index) => present[index]);
}

export async function findConfigFile(root: string): Promise<string> {
  const [file] = await existingConfigFiles(root);
  if (file === undefined) {
    throw new CliError(
      `no ${CONFIG_NAMES.join(", ")} found in ${root}; run \`lawbook init\` to create one`,
    );
  }
  return file;
}

async function readConfigText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new CliError(`cannot read ${file}: ${errorMessage(error)}`);
  }
}

/** YAML is a superset of JSON, so one parser covers `lawbook.json` too. */
function parseConfigText(file: string, source: string): unknown {
  try {
    return YAML.parse(source);
  } catch (error) {
    throw new CliError(`${file}: ${errorMessage(error)}`);
  }
}

export async function loadConfig(file: string): Promise<Config> {
  const parsed = configSchema.safeParse(parseConfigText(file, await readConfigText(file)));
  if (!parsed.success) {
    throw new CliError(`${file}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
