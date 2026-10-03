# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Commands

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets
cargo package --locked --allow-dirty
```

`uvx prek run -a` runs the same three Rust checks plus the file hygiene hooks,
and is what CI runs.

The docs site in `docs/` is a [Blume](https://useblume.dev) project. Behavior
docs live in `docs/content/`; the README is a landing page that links to
them. The `Docs` workflow builds and validates the site on pull requests and
deploys `main` to GitHub Pages:

```sh
pnpm --dir docs install
pnpm --dir docs run build
pnpm --dir docs run validate
```

Run one test by name:

```sh
cargo test --test cli version_prints_crate_version
```

Score the crate with poly-crap, which is also the CI gate:

```sh
cargo llvm-cov --locked --all-targets --all-features --lcov --output-path lcov.info
poly-crap --language rust --coverage lcov.info --threshold 5 --fail-above
```

Toolchain is pinned to Rust 1.88.0 in `rust-toolchain.toml`; the edition is
2024.

## Architecture

One binary over one library. `src/main.rs` parses the CLI; logic belongs in
library modules under `src/` that take plain data.

**Exit codes carry meaning.** 0 success, 1 a requested check failed, 2
anything wrong with usage, input, or output. `main.rs` maps these.

## Conventions

- CI fails the build when any function scores above CRAP 5. Keep functions
  short and test them.
- No test may need network access, credentials, or machine state.
- The integration tests build every command through the `lawbook()` helper in
  `tests/cli.rs`, which scrubs `NO_COLOR`, `CLICOLOR`, and `CLICOLOR_FORCE`.
- Conventional Commit subjects. The project squash-merges, so the PR title
  becomes the commit on `main` and drives release-please.
- Never add `Co-Authored-By` or AI attribution to commits.
