import { Command, CommanderError } from "commander";
import pkg from "../package.json" with { type: "json" };

/** Where the CLI writes. Tests pass their own to capture output. */
export interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function program(output: Output): Command {
  return new Command()
    .name("lawbook")
    .description(pkg.description)
    .version(pkg.version)
    .exitOverride()
    .configureOutput({ writeOut: output.stdout, writeErr: output.stderr });
}

/** Commander throws for `--help` and `--version` too, with exit code 0. */
function exitCode(error: unknown, output: Output): number {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? 0 : 2;
  }
  output.stderr(`error: ${String(error)}\n`);
  return 2;
}

/**
 * Runs the CLI on the arguments after the binary name and returns the exit
 * code: 0 success, 2 anything wrong with usage, input, or output.
 */
export async function run(
  args: readonly string[],
  output: Output = processOutput,
): Promise<number> {
  try {
    await program(output).parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    return exitCode(error, output);
  }
}
