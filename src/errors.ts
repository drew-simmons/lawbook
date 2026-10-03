/**
 * A problem with usage, input, or output that the user can act on. The CLI
 * prints the message without a stack trace and exits with code 2.
 */
export class CliError extends Error {
  override readonly name = "CliError";
}

/** The text the CLI shows for an error: the message of a `CliError`, else the whole error. */
export function errorMessage(error: unknown): string {
  return error instanceof CliError ? error.message : String(error);
}
