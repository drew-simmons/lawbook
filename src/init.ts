import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existingConfigFiles } from "./config.ts";
import { CliError } from "./errors.ts";

/** The starter config. Its rules pass in an empty directory. */
export const TEMPLATE = `# Lawbook checks this directory against the rules below.
# Format reference: https://drew-simmons.github.io/lawbook/configuration
version: 1

# Paths no rule looks at. These are the defaults.
# ignore:
#   - "**/node_modules/**"
#   - "**/.git/**"

rules:
  # \`absent\` fails when the path exists.
  - id: no-env-file
    description: Secrets stay out of the repository
    absent: .env

  # \`forbid\` fails on every line of a selected file that matches the pattern.
  - id: no-merge-markers
    description: Conflict markers never land
    files: ["**/*.{ts,js,json,md,yaml,yml}"]
    forbid: '^(<{7}|>{7}) '

  # \`require\` fails for every selected file the pattern does not match.
  # - id: license-header
  #   files: ["src/**/*.ts"]
  #   require: '^// SPDX-License-Identifier: '

  # \`exists\` fails when the path is missing.
  # - id: has-readme
  #   exists: README.md
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
