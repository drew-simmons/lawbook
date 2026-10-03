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
export { cachedJudge, cacheKey, DEFAULT_CACHE_DIR } from "./judge/cache.ts";
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
  NO_USAGE,
  type Usage,
  type Verdict,
} from "./judge/judge.ts";
export { messagesJudge, type ParseFn } from "./judge/messages.ts";
export { type Format, FORMATS, FORMATTERS } from "./formats.ts";
export { formatGithub } from "./github.ts";
export { type Formatter, formatJson, formatText, type ReportMeta } from "./report.ts";
export {
  exitCodeFor,
  type Finding,
  type Report,
  type RuleResult,
  type RuleStatus,
  skipResult,
  type Summary,
  type UsageTotals,
} from "./result.ts";
export { formatSarif } from "./sarif.ts";
export { parseSuppressions, suppressed, type Suppressions } from "./suppress.ts";
