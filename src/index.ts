/**
 * Library behind the `lawbook` binary. `src/bin.ts` starts the CLI; the
 * logic lives in modules here.
 */
export { check, type CheckOptions } from "./check.ts";
export {
  type Config,
  configSchema,
  DEFAULT_MODELS,
  findConfigFile,
  type LlmConfig,
  loadConfig,
  type Provider,
  type Rule,
  type RuleKind,
} from "./config.ts";
export { type Deps, type Output, run } from "./cli.ts";
export { CliError } from "./errors.ts";
export { init } from "./init.ts";
export { defaultJudges } from "./judge/index.ts";
export {
  type Answer,
  answerSchema,
  type Decision,
  decisionSchema,
  type Judge,
  type JudgeFactory,
  type JudgeRequest,
  type Judges,
  type Verdict,
} from "./judge/judge.ts";
export { messagesJudge, type ParseFn } from "./judge/messages.ts";
export { type Format, formatJson, formatText } from "./report.ts";
export {
  exitCodeFor,
  type Finding,
  type Report,
  type RuleResult,
  type RuleStatus,
  type Summary,
} from "./result.ts";
