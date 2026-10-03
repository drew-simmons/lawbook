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

**Exit codes carry meaning.** 0 success, 1 a requested check failed, 2
anything wrong with usage, input, or output. `src/cli.ts` maps these.

## Conventions

- CI fails the build when any function scores above CRAP 5. Keep functions
  short and test them.
- No test may need network access, credentials, or machine state.
- The tests in `tests/cli.test.ts` call every command through the
  `lawbook()` helper, which runs the CLI in process, captures its output,
  and scrubs `NO_COLOR`, `CLICOLOR`, and `CLICOLOR_FORCE`.
- Conventional Commit subjects. The project squash-merges, so the PR title
  becomes the commit on `main` and drives release-please.
- Never add `Co-Authored-By` or AI attribution to commits.
