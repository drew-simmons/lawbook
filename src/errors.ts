/**
 * A problem with usage, input, or output that the user can act on. The CLI
 * prints the message without a stack trace and exits with code 2.
 */
export class CliError extends Error {
  override readonly name = "CliError";
}

/** The message of a `CliError`. Anything else is a bug, so it propagates. */
export function cliErrorMessage(error: unknown): string {
  if (error instanceof CliError) {
    return error.message;
  }
  throw error;
}

/** The text the CLI shows for an error: the message of a `CliError`, else the whole error. */
export function errorMessage(error: unknown): string {
  return error instanceof CliError ? error.message : String(error);
}
