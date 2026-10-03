import { formatGithub } from "./github.ts";
import { type Formatter, formatJson, formatText } from "./report.ts";
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
