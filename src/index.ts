/**
 * Library behind the `lawbook` binary. `src/bin.ts` starts the CLI; the
 * logic lives in modules here.
 */
export { check, type CheckOptions } from "./check.ts";
export {
  type Config,
  configSchema,
  findConfigFile,
  loadConfig,
  type Rule,
  type RuleKind,
} from "./config.ts";
export { type Output, run } from "./cli.ts";
export { CliError } from "./errors.ts";
export { init } from "./init.ts";
export { type Format, formatJson, formatText } from "./report.ts";
export {
  exitCodeFor,
  type Finding,
  type Report,
  type RuleResult,
  type RuleStatus,
  type Summary,
} from "./result.ts";
