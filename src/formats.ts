import { formatGithub } from "./github.ts";
import type { FixtureReport } from "./fixtures.ts";
import { formatGitlab } from "./gitlab.ts";
import type { Plan } from "./plan.ts";
import {
  type Formatter,
  formatFixturesJson,
  formatFixturesText,
  formatJson,
  formatPlanJson,
  formatPlanText,
  formatText,
} from "./report.ts";
import { formatSarif } from "./sarif.ts";

/** Every `--format` value and the formatter behind it. */
export const FORMATTERS = {
  text: formatText,
  json: formatJson,
  github: formatGithub,
  sarif: formatSarif,
  gitlab: formatGitlab,
} satisfies Record<string, Formatter>;

export type Format = keyof typeof FORMATTERS;

export const FORMATS = Object.keys(FORMATTERS) as Format[];

/** The formats a `--dry-run` plan can take; the annotation formats have nothing to annotate. */
export const PLAN_FORMATTERS: Partial<Record<Format, (plan: Plan) => string>> = {
  text: formatPlanText,
  json: formatPlanJson,
};

/** The formats `lawbook test` prints; there are no findings to annotate. */
export const FIXTURE_FORMATTERS = {
  text: formatFixturesText,
  json: formatFixturesJson,
} satisfies Partial<Record<Format, (report: FixtureReport) => string>>;

export type FixtureFormat = keyof typeof FIXTURE_FORMATTERS;

export const FIXTURE_FORMATS = Object.keys(FIXTURE_FORMATTERS) as FixtureFormat[];
