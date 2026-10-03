# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Commands

```sh
pnpm run lint
pnpm run typecheck
pnpm test
pnpm pack --dry-run
```

`pnpm run lint` runs oxlint and checks formatting with oxfmt;
`pnpm run format` applies both tools' fixes. `pnpm test` builds `dist/` first,
because one test runs the built binary.

`uvx prek run -a` runs the same three checks plus the file hygiene hooks,
and is what CI runs.

The docs site in `docs/` is a [Blume](https://useblume.dev) project with its
own `package.json` and lockfile. Behavior docs live in `docs/content/`; the
README is a landing page that links to them. The `Docs` workflow builds and
validates the site on pull requests and deploys `main` to GitHub Pages:

```sh
pnpm --dir docs install
pnpm --dir docs run build
pnpm --dir docs run validate
```

Run one test by name:

```sh
pnpm exec vitest run -t "version prints package version"
```

Score the package with poly-crap, which is also the CI gate:

```sh
pnpm run coverage
poly-crap --language typescript --coverage coverage/lcov.info --threshold 5 --fail-above
```

The Node.js version is pinned to 24 in `.node-version`; the package supports
22.12 and newer. The pnpm version is pinned in `package.json`.

## Architecture

One binary over one library. `src/bin.ts` is the entry and only calls `run`
in `src/cli.ts`, which parses the CLI; logic belongs in library modules
under `src/` that take plain data. tsdown bundles `src/bin.ts` and
`src/index.ts` into `dist/`.

- `src/config.ts` holds the zod schema for one `lawbook.yaml` and
  `loadConfig`, which resolves `extends` (paths relative to the file, or
  package specifiers through `createRequire`) depth-first, inherits only
  `rules`, and rejects cycles and duplicate ids across files. Each rule
  schema adds a `kind` so `src/check.ts` can dispatch through a lookup
  table instead of a chain of `if`s. New rule kinds add a schema, a runner
  in `src/rules/`, and a table entry.
- `src/candidates.ts` turns `--files`, `--changed`, `--since`, and the
  `.gitignore` listing into the candidate set; `src/plan.ts` is `--dry-run`,
  which selects files the way `check` does but reads nothing and builds no
  judge.
- `src/files.ts` globs the files a rule selects and, when `check` was given
  `--files`, `--changed`, or `--since`, keeps only the candidates in
  `RuleContext.candidates`; with none given, inside a git work tree, the
  candidates are what `git ls-files` lists, so `.gitignore` applies. It
  reads files once as a Buffer and drops binary ones (a NUL in the first
  8 KiB). `src/git.ts` runs git under the root and rebases the paths it
  reports onto the root; tests build real repositories in a temp dir with
  `gitRepo()` from `tests/helpers.ts`.
- `src/suppress.ts` parses `lawbook-disable-next-line|line|file <ids>`
  comments; `forbid` drops suppressed lines, `require` passes a file that
  disables it, and `standard` lists such a file as skipped without a request.
- `src/rules/deterministic.ts` implements `forbid`, `require`, `exists`, and
  `absent`. Runners take a rule and a `RuleContext` and return a `RuleResult`
  from `src/result.ts`. `src/rules/llm.ts` implements `standard` through a
  `Judge`, and skips when the context has none (`--no-llm`). It judges up
  to `llm.concurrency` files at once through `mapLimit` in `src/pool.ts`,
  which keeps results in input order, and lists files over `llm.maxBytes`
  under `RuleResult.skipped` instead of sending them. A `scope: set` rule
  sends every file in one request and gets one `decision`; the scope picks
  the runner, the guards, and the result shape through lookup tables. A
  `JudgeRequest` always carries `files`, one for `scope: file`.
- `src/judge/` holds the `Judge` interface, the provider-neutral
  `messagesJudge` core (fully tested with a stub `parse`), the Bedrock
  and Anthropic adapters, which only build a client, and `cache.ts`, a
  `Judge` wrapper that answers from `node_modules/.cache/lawbook` when the
  hash of model, prompt, standard, path, and content matches. The request
  marks the standard block for the provider's prompt cache, and every
  `Verdict` carries the provider's token `usage`, summed per rule and in
  the summary. The adapters import
  their SDK lazily and stay at complexity 1, since no test covers them. `run`
  takes the factories as its `deps` argument; tests inject fakes. The judge
  returns a `Verdict`: a noul decision in the Jev decision schema plus a
  reason; `src/rules/llm.ts` compares the probability to the rule's
  `threshold`.
- `src/result.ts` turns findings into a `RuleResult`: a rule's `level`
  decides whether findings make it `fail` or `warn`, and only `fail` counts
  toward the exit code.
- `src/report.ts` formats a `Report` as text or JSON; `src/github.ts` and
  `src/sarif.ts` add GitHub workflow commands and SARIF. `src/formats.ts`
  is the `--format` table, and every formatter takes the report plus a
  `ReportMeta` (version and root) even if it ignores it.
- `src/errors.ts` has `CliError` for problems the user can act on; the CLI
  prints its message without a stack and exits 2.

**Exit codes carry meaning.** 0 success, 1 a requested check failed, 2
anything wrong with usage, input, or output. `src/cli.ts` maps these: a
`CommanderError` with code 0 is help or version, any other error is 2, and
`check` returns 1 or 2 through `exitCodeFor`. A provider error on a file is
not thrown: `src/rules/llm.ts` records it as that file's finding, halts the
rest of the rule, and gives the rule status `error`, so the report still
prints before the run exits 2.

## Conventions

- CI fails the build when any function scores above CRAP 5. Keep functions
  short and test them.
- No test may need network access, credentials, or machine state.
- Tests call every command through the `lawbook()` helper in
  `tests/helpers.ts`, which runs the CLI in process, captures its output,
  and scrubs `NO_COLOR`, `CLICOLOR`, and `CLICOLOR_FORCE`. `useTempDir()`
  gives each test an empty directory to pass as the root; never
  `process.chdir`. `lawbook()` refuses to build a judge; tests that need
  one use `fakeJudge()` with `lawbookWith()`.
- Conventional Commit subjects. The project squash-merges, so the PR title
  becomes the commit on `main` and drives release-please.
- Never add `Co-Authored-By` or AI attribution to commits.
