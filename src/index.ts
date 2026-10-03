/**
 * Library behind the `lawbook` binary. `src/bin.ts` starts the CLI; the
 * logic lives in modules here.
 */
export {
  applyBaseline,
  type Baseline,
  type BaselineEntry,
  baselineSchema,
  buildBaseline,
  parseBaseline,
  readBaseline,
  writeBaseline,
} from "./baseline.ts";
export { type CandidateSource, candidatesFor } from "./candidates.ts";
export { check, type CheckOptions, judgesFor } from "./check.ts";
export {
  type Config,
  type ConfigFile,
  configSchema,
  DEFAULT_MODELS,
  findConfigFile,
  type LlmConfig,
  loadConfig,
  type Provider,
  resolveConfig,
  ruleLlm,
  type Rule,
  type RuleKind,
  type Scope,
  SCOPES,
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
export { messagesJudge, type ParseFn, requestLabel } from "./judge/messages.ts";
export {
  buildChatRequest,
  chatJudge,
  type ChatParams,
  type ChatParseFn,
  toChatUsage,
  toChatVerdict,
} from "./judge/chat.ts";
export { type Plan, plan, type PlanOptions, type PlanRule } from "./plan.ts";
export { type Format, FORMATS, FORMATTERS, PLAN_FORMATTERS } from "./formats.ts";
export { formatGithub } from "./github.ts";
export { formatGitlab, type GitlabIssue } from "./gitlab.ts";
export {
  type Formatter,
  formatJson,
  formatPlanJson,
  formatPlanText,
  formatText,
  type ReportMeta,
} from "./report.ts";
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
