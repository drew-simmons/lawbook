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
export { type CandidateSource, candidatesFor, type Selection, selectionFor } from "./candidates.ts";
export { assertWithinBudget, parseCount, requestLimit } from "./budget.ts";
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
  answerJsonSchema,
  answerSchema,
  type Decision,
  decisionOf,
  decisionSchema,
  type Judge,
  type JudgeFactory,
  type JudgeRequest,
  type Judges,
  NO_USAGE,
  parseAnswer,
  type Usage,
  type Verdict,
} from "./judge/judge.ts";
export { CHANGED_LINES_PROMPT, fileBlocks, requestLabel, systemTexts } from "./judge/prompt.ts";
export {
  type ChangedLines,
  type ChangeMap,
  formatRanges,
  inRanges,
  isChanged,
  type LineRange,
  parseHunks,
} from "./lines.ts";
export { defaultExec, type Exec } from "./judge/cli.ts";
export { claudeArgs, claudeCodeJudge, toClaudeVerdict } from "./judge/claude-code.ts";
export { codexArgs, codexJudge, codexPrompt, toCodexVerdict } from "./judge/codex.ts";
export { kiroAgent, kiroArgs, kiroJudge, toKiroVerdict } from "./judge/kiro.ts";
export { type Plan, plan, type PlanOptions, type PlanRule } from "./plan.ts";
export { configJsonSchema, formatSchema, SCHEMA_URL } from "./schema.ts";
export {
  FIXTURE_FORMATS,
  FIXTURE_FORMATTERS,
  type FixtureFormat,
  type Format,
  FORMATS,
  FORMATTERS,
  PLAN_FORMATTERS,
} from "./formats.ts";
export {
  exitCodeForFixtures,
  type Expected,
  type FixtureCase,
  type FixtureOptions,
  type FixtureReport,
  type FixtureRule,
  testFixtures,
} from "./fixtures.ts";
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
