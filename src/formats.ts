import { formatGithub } from "./github.ts";
import type { Plan } from "./plan.ts";
import {
  type Formatter,
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
} satisfies Record<string, Formatter>;

export type Format = keyof typeof FORMATTERS;

export const FORMATS = Object.keys(FORMATTERS) as Format[];

/** The formats a `--dry-run` plan can take; the annotation formats have nothing to annotate. */
export const PLAN_FORMATTERS: Partial<Record<Format, (plan: Plan) => string>> = {
  text: formatPlanText,
  json: formatPlanJson,
};
