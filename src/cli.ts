import { Command, CommanderError, Option } from "commander";
import pkg from "../package.json" with { type: "json" };
import { check } from "./check.ts";
import { findConfigFile, loadConfig } from "./config.ts";
import { CliError, errorMessage } from "./errors.ts";
import { init } from "./init.ts";
import { defaultJudges } from "./judge/index.ts";
import { plan, type PlanOptions } from "./plan.ts";
import type { Judges } from "./judge/judge.ts";
import { type Format, FORMATS, FORMATTERS, PLAN_FORMATTERS } from "./formats.ts";
import { exitCodeFor } from "./result.ts";

/** Where the CLI writes. Tests pass their own to capture output. */
export interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** What reaches outside the process. Tests pass fakes so nothing does. */
export interface Deps {
  judges: Judges;
}

const processOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const defaultDeps: Deps = { judges: defaultJudges };

interface CheckFlags {
  config?: string;
  format: Format;
  only?: string[];
  llm: boolean;
  files?: string[];
  changed?: boolean;
  since?: string;
  cache: boolean;
  cacheDir?: string;
  dryRun?: boolean;
  explain?: boolean;
}

/** Commander actions return nothing, so the exit code travels in here. */
interface Exit {
  code: number;
}

/** Lists what `check` would look at. Only text and JSON apply, since there are no findings yet. */
async function runPlan(options: PlanOptions, format: Format, output: Output): Promise<number> {
  const formatter = PLAN_FORMATTERS[format];
  if (formatter === undefined) {
    throw new CliError(`--dry-run prints text or json, not ${format}`);
  }
  output.stdout(formatter(await plan(options)));
  return 0;
}

async function runCheck(
  root: string,
  flags: CheckFlags,
  output: Output,
  deps: Deps,
): Promise<number> {
  const file = flags.config ?? (await findConfigFile(root));
  const config = await loadConfig(file);
  const options: PlanOptions = {
    root,
    config,
    only: flags.only,
    llm: flags.llm,
    files: flags.files,
    changed: flags.changed,
    since: flags.since,
  };
  if (flags.dryRun === true) {
    return runPlan(options, flags.format, output);
  }
  const report = await check({
    ...options,
    cache: flags.cache,
    cacheDir: flags.cacheDir,
    judges: deps.judges,
    explain: flags.explain,
  });
  output.stdout(FORMATTERS[flags.format](report, { version: pkg.version, root }));
  return exitCodeFor(report);
}

function initCommand(output: Output): Command {
  return new Command("init")
    .description("write a starter lawbook.yaml")
    .argument("[root]", "directory to write into", ".")
    .action(async (root: string) => {
      output.stdout(`wrote ${await init(root)}\n`);
    });
}

function checkCommand(output: Output, deps: Deps, exit: Exit): Command {
  return new Command("check")
    .description("run the rules in lawbook.yaml against a directory")
    .argument("[root]", "directory to check", ".")
    .option("-c, --config <file>", "config file (default: lawbook.yaml in root)")
    .addOption(new Option("--format <format>", "output format").choices(FORMATS).default("text"))
    .option("--only <ids...>", "run only the rules with these ids")
    .option("--no-llm", "skip rules judged by a model and report them as skipped")
    .option("--files <paths...>", "check only these files, relative to the current directory")
    .option(
      "--changed",
      "check only files changed in the working tree: staged, unstaged, untracked",
    )
    .option("--since <ref>", "check only files committed since the merge base with ref")
    .option("--dry-run", "list the files each rule would check and exit without reading them")
    .option("--explain", "print the model's reason for files that pass, not only for findings")
    .option("--no-cache", "ask the model even when a cached verdict exists")
    .option(
      "--cache-dir <dir>",
      "where verdicts are cached (default: node_modules/.cache/lawbook under root)",
    )
    .action(async (root: string, flags: CheckFlags) => {
      exit.code = await runCheck(root, flags, output, deps);
    });
}

/** Subcommands added with `addCommand` inherit output and exit handling only when asked. */
function program(output: Output, deps: Deps, exit: Exit): Command {
  const root = new Command()
    .name("lawbook")
    .description(pkg.description)
    .version(pkg.version)
    .exitOverride()
    .configureOutput({ writeOut: output.stdout, writeErr: output.stderr });
  root.addCommand(initCommand(output).copyInheritedSettings(root));
  root.addCommand(checkCommand(output, deps, exit).copyInheritedSettings(root));
  return root;
}

/** Commander throws for `--help` and `--version` too, with exit code 0. */
function exitCode(error: unknown, output: Output): number {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? 0 : 2;
  }
  output.stderr(`error: ${errorMessage(error)}\n`);
  return 2;
}

/**
 * Runs the CLI on the arguments after the binary name and returns the exit
 * code: 0 success, 1 a requested check failed, 2 anything wrong with usage,
 * input, or output.
 */
export async function run(
  args: readonly string[],
  output: Output = processOutput,
  deps: Deps = defaultDeps,
): Promise<number> {
  const exit: Exit = { code: 0 };
  try {
    await program(output, deps, exit).parseAsync(args, { from: "user" });
    return exit.code;
  } catch (error) {
    return exitCode(error, output);
  }
}
