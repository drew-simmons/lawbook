import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
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
/** What a `files` rule selects with: globs to include and globs to leave out. */
const selection = { files: z.array(text).min(1), exclude: z.array(text).default([]) };
const probability = z.number().min(0).max(1);

const forbidRule = z
  .object({ ...base, ...selection, forbid: text })
  .strict()
  .transform((rule) => ({ kind: "forbid" as const, ...rule }));
const requireRule = z
  .object({ ...base, ...selection, require: text })
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
/** Whether a `standard` rule judges each file alone or all selected files in one request. */
export const SCOPES = ["file", "set"] as const;

export type Scope = (typeof SCOPES)[number];

export const PROVIDERS = ["bedrock", "anthropic", "openai"] as const;

export type Provider = (typeof PROVIDERS)[number];

/** The model each provider uses when the config names none; `openai` has none, so `model` is required. */
export const DEFAULT_MODELS: Record<Provider, string | undefined> = {
  bedrock: "anthropic.claude-opus-5-5",
  anthropic: "claude-opus-5-5",
  openai: undefined,
};

/** The `llm` keys that belong to one provider, and which. */
const PROVIDER_KEYS = { region: "bedrock", baseUrl: "openai" } as const satisfies Record<
  string,
  Provider
>;

type ProviderKey = keyof typeof PROVIDER_KEYS;

const llmSchema = z
  .object({
    provider: z.enum(PROVIDERS).default("bedrock"),
    model: text.optional(),
    /** Bedrock only: the AWS region. */
    region: text.optional(),
    /** OpenAI only: a server that speaks Chat Completions, in place of api.openai.com. */
    baseUrl: z.url().optional(),
    /** How many files a `standard` rule judges at once. */
    concurrency: z.int().min(1).default(4),
    /** The largest file, in bytes, a `standard` rule sends to the model. */
    maxBytes: z.int().min(1).default(131072),
    /** Whether verdicts are cached on disk and reused for unchanged files. */
    cache: z.boolean().default(true),
  })
  .strict()
  .check((ctx) => {
    for (const key of Object.keys(PROVIDER_KEYS) as ProviderKey[]) {
      if (ctx.value[key] !== undefined && ctx.value.provider !== PROVIDER_KEYS[key]) {
        ctx.issues.push({
          code: "custom",
          input: ctx.value,
          path: [key],
          message: `${key} applies to the ${PROVIDER_KEYS[key]} provider only`,
        });
      }
    }
  })
  .transform((llm, ctx) => {
    const model = llm.model ?? DEFAULT_MODELS[llm.provider];
    if (model === undefined) {
      ctx.issues.push({
        code: "custom",
        input: llm,
        path: ["model"],
        message: `set llm.model; the ${llm.provider} provider has no default`,
      });
      return z.NEVER;
    }
    return { ...llm, model };
  });

export type LlmConfig = z.infer<typeof llmSchema>;

/** What a `standard` rule may override in `llm`: which model answers it, and where. */
const ruleLlmSchema = z
  .object({
    provider: z.enum(PROVIDERS).optional(),
    model: text.optional(),
    region: text.optional(),
    baseUrl: z.url().optional(),
  })
  .strict();

// A `standard` rule is a yes/no question; a file, or the set, fails below `threshold`.
const standardRule = z
  .object({
    ...base,
    ...selection,
    standard: text,
    threshold: probability.default(0.5),
    scope: z.enum(SCOPES).default("file"),
    llm: ruleLlmSchema.optional(),
    /** Root-relative files sent with every request as reference material, never judged. */
    context: z.array(text).default([]),
  })
  .strict()
  .transform((rule) => ({ kind: "standard" as const, ...rule }));

export const ruleSchema = z.union([forbidRule, requireRule, existsRule, absentRule, standardRule]);

export type Rule = z.infer<typeof ruleSchema>;
export type RuleKind = Rule["kind"];
export type RuleOf<K extends RuleKind> = Extract<Rule, { kind: K }>;

/**
 * The run's `llm` with a rule's overrides on top. A rule that names another
 * provider starts from that provider's defaults, not the top-level model,
 * region, or URL, which belong to the top-level provider.
 */
function mergeLlm(top: LlmConfig, rule: RuleOf<"standard">): z.input<typeof llmSchema> {
  const override = rule.llm ?? {};
  const provider = override.provider ?? top.provider;
  const same = provider === top.provider;
  return {
    provider,
    model: override.model ?? (same ? top.model : undefined),
    region: override.region ?? (same ? top.region : undefined),
    baseUrl: override.baseUrl ?? (same ? top.baseUrl : undefined),
    concurrency: top.concurrency,
    maxBytes: top.maxBytes,
    cache: top.cache,
  };
}

/** The `llm` a `standard` rule is judged with. `loadConfig` has already validated it. */
export function ruleLlm(top: LlmConfig, rule: RuleOf<"standard">): LlmConfig {
  return llmSchema.parse(mergeLlm(top, rule));
}

/** A rule's `llm` is checked merged, so a `region` under an `anthropic` override is caught at load time. */
function assertRuleLlm(file: string, top: LlmConfig, rule: Rule): void {
  if (rule.kind !== "standard" || rule.llm === undefined) {
    return;
  }
  const parsed = llmSchema.safeParse(mergeLlm(top, rule));
  if (!parsed.success) {
    throw new CliError(`${file}: rule "${rule.id}": llm: ${z.prettifyError(parsed.error)}`);
  }
}

/** One config file's `extends`: a path or package, or a list of them, always as a list. */
const extendsSchema = z
  .union([text, z.array(text)])
  .default([])
  .transform((entries) => (typeof entries === "string" ? [entries] : entries));

/** One config file as written, before its `extends` are pulled in. */
export const configSchema = z
  .object({
    version: z.literal(1),
    /** Config files whose rules come first, by path or package specifier. */
    extends: extendsSchema,
    ignore: z.array(z.string()).default(DEFAULT_IGNORE),
    /** Whether files `.gitignore` covers are left out when the root is in a git work tree. */
    gitignore: z.boolean().default(true),
    // `prefault` runs the defaults through the schema, so `model` gets filled in.
    llm: llmSchema.prefault({}),
    rules: z.array(ruleSchema),
  })
  .strict();

export type ConfigFile = z.infer<typeof configSchema>;

/** A config with its `extends` resolved: every rule, in order, and the top-level settings. */
export type Config = Omit<ConfigFile, "extends">;

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

async function loadFile(file: string): Promise<ConfigFile> {
  const parsed = configSchema.safeParse(parseConfigText(file, await readConfigText(file)));
  if (!parsed.success) {
    throw new CliError(`${file}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** A rule and the config file it came from, for error messages. */
interface Owned {
  rule: Rule;
  file: string;
}

function isPathLike(entry: string): boolean {
  return entry.startsWith(".") || path.isAbsolute(entry);
}

/** A path entry is relative to the extending file's directory; anything else is a package specifier. */
function resolveExtend(from: string, entry: string): string {
  if (isPathLike(entry)) {
    return path.resolve(path.dirname(from), entry);
  }
  try {
    return createRequire(path.resolve(from)).resolve(entry);
  } catch (error) {
    throw new CliError(`${from}: cannot resolve extends "${entry}": ${errorMessage(error)}`);
  }
}

/** The rules of every file `entries` name, depth-first, each with its own `extends` first. */
async function extendedRules(from: string, entries: string[], chain: string[]): Promise<Owned[]> {
  const owned: Owned[] = [];
  for (const entry of entries) {
    owned.push(...(await loadRules(resolveExtend(from, entry), chain)));
  }
  return owned;
}

/** `file`'s rules after those it extends. `chain` holds the real paths above it, to catch cycles. */
async function loadRules(file: string, chain: string[]): Promise<Owned[]> {
  const parsed = await loadFile(file);
  const real = await realpath(file);
  if (chain.includes(real)) {
    throw new CliError(`extends cycle: ${[...chain, real].join(" -> ")}`);
  }
  const inherited = await extendedRules(file, parsed.extends, [...chain, real]);
  return [...inherited, ...parsed.rules.map((rule) => ({ rule, file }))];
}

function duplicateMessage(id: string, first: string, file: string): string {
  return first === file
    ? `${file}: duplicate rule id "${id}"`
    : `duplicate rule id "${id}" in ${first} and ${file}`;
}

/** Every id once across every file; the error names where it repeats. */
function assertUniqueIds(owned: Owned[]): void {
  const seen = new Map<string, string>();
  for (const { rule, file } of owned) {
    const first = seen.get(rule.id);
    if (first !== undefined) {
      throw new CliError(duplicateMessage(rule.id, first, file));
    }
    seen.set(rule.id, file);
  }
}

/**
 * `top` with its `extends` pulled in: inherited rules first, then its own.
 * Only rules are inherited; `ignore`, `gitignore`, and `llm` come from `top`.
 */
export async function resolveConfig(file: string, top: ConfigFile): Promise<Config> {
  const inherited = await extendedRules(file, top.extends, [await realpath(file)]);
  const owned = [...inherited, ...top.rules.map((rule) => ({ rule, file }))];
  assertUniqueIds(owned);
  for (const entry of owned) {
    assertRuleLlm(entry.file, top.llm, entry.rule);
  }
  return {
    version: top.version,
    ignore: top.ignore,
    gitignore: top.gitignore,
    llm: top.llm,
    rules: owned.map((entry) => entry.rule),
  };
}

export async function loadConfig(file: string): Promise<Config> {
  return resolveConfig(file, await loadFile(file));
}
