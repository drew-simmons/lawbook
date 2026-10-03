import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existingConfigFiles } from "./config.ts";
import { CliError } from "./errors.ts";

/** The starter config. Its rules pass in an empty directory. */
export const TEMPLATE = `# Lawbook checks this directory against the rules below.
# Format reference: https://drew-simmons.github.io/lawbook/configuration
version: 1

# Config files whose rules run before the ones below: a path relative to this
# file, or a package installed under node_modules.
# extends: ["./rules/base.yaml", "@acme/lawbook-rules"]

# Paths no rule looks at. These are the defaults.
# ignore:
#   - "**/node_modules/**"
#   - "**/.git/**"

# Inside a git work tree, files .gitignore covers are left out. This is the default.
# gitignore: true

# The model that judges \`standard\` rules. These are the defaults.
# llm:
#   provider: bedrock           # bedrock | anthropic | openai
#   model: anthropic.claude-opus-5-5   # required for openai
#   region: us-west-2           # bedrock only; else AWS_REGION
#   baseUrl: http://localhost:11434/v1 # openai only: a compatible server
#   concurrency: 4              # files judged at once
#   maxBytes: 131072            # largest file sent to the model
#   cache: true                 # reuse verdicts for unchanged files

rules:
  # \`absent\` fails when the path exists.
  - id: no-env-file
    description: Secrets stay out of the repository
    absent: .env

  # \`forbid\` fails on every line of a selected file that matches the pattern.
  # \`message\` replaces the matched line in the finding.
  - id: no-merge-markers
    description: Conflict markers never land
    files: ["**/*.{ts,js,json,md,yaml,yml}"]
    forbid: '^(<{7}|>{7}) '
    message: resolve the merge conflict before committing

  # \`require\` fails for every selected file the pattern does not match.
  # \`level: warn\` reports a rule's findings without failing the run.
  # - id: license-header
  #   level: warn
  #   files: ["src/**/*.ts"]
  #   require: '^// SPDX-License-Identifier: '

  # \`exists\` fails when the path is missing.
  # - id: has-readme
  #   exists: README.md

  # \`standard\` asks the model for the probability that each selected file
  # meets the prose, and fails a file below \`threshold\` (default 0.5).
  # - id: errors-are-actionable
  #   files: ["src/**/*.ts"]
  #   threshold: 0.5
  #   standard: |
  #     Every error message shown to a user says what went wrong and what
  #     to do next.
  #   # Reference files the model reads but does not judge.
  #   context: ["docs/style.md"]
  #   # A cheaper model for this rule alone; provider, region, and baseUrl work too.
  #   llm: { model: anthropic.claude-sonnet-5-5 }
`;

/** Writes `lawbook.yaml` into `root` and returns its path. */
export async function init(root: string): Promise<string> {
  const [existing] = await existingConfigFiles(root);
  if (existing !== undefined) {
    throw new CliError(`${existing} already exists`);
  }
  const file = path.join(root, "lawbook.yaml");
  await writeFile(file, TEMPLATE, { flag: "wx" });
  return file;
}
