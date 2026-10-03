import { Command, CommanderError, Option } from "commander";
import pkg from "../package.json" with { type: "json" };
import { check } from "./check.ts";
import { findConfigFile, loadConfig } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { init } from "./init.ts";
import { type Format, FORMATTERS } from "./report.ts";
import { exitCodeFor } from "./result.ts";

/** Where the CLI writes. Tests pass their own to capture output. */
export interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

interface CheckFlags {
  config?: string;
  format: Format;
  only?: string[];
}

/** Commander actions return nothing, so the exit code travels in here. */
interface Exit {
  code: number;
}

async function runCheck(root: string, flags: CheckFlags, output: Output): Promise<number> {
  const file = flags.config ?? (await findConfigFile(root));
  const config = await loadConfig(file);
  const report = await check({ root, config, only: flags.only });
  output.stdout(FORMATTERS[flags.format](report));
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

function checkCommand(output: Output, exit: Exit): Command {
  return new Command("check")
    .description("run the rules in lawbook.yaml against a directory")
    .argument("[root]", "directory to check", ".")
    .option("-c, --config <file>", "config file (default: lawbook.yaml in root)")
    .addOption(
      new Option("--format <format>", "output format").choices(["text", "json"]).default("text"),
    )
    .option("--only <ids...>", "run only the rules with these ids")
    .action(async (root: string, flags: CheckFlags) => {
      exit.code = await runCheck(root, flags, output);
    });
}

/** Subcommands added with `addCommand` inherit output and exit handling only when asked. */
function program(output: Output, exit: Exit): Command {
  const root = new Command()
    .name("lawbook")
    .description(pkg.description)
    .version(pkg.version)
    .exitOverride()
    .configureOutput({ writeOut: output.stdout, writeErr: output.stderr });
  root.addCommand(initCommand(output).copyInheritedSettings(root));
  root.addCommand(checkCommand(output, exit).copyInheritedSettings(root));
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
): Promise<number> {
  const exit: Exit = { code: 0 };
  try {
    await program(output, exit).parseAsync(args, { from: "user" });
    return exit.code;
  } catch (error) {
    return exitCode(error, output);
  }
}
