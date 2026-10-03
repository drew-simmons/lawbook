# lawbook

[![CI](https://img.shields.io/github/actions/workflow/status/drew-simmons/lawbook/ci.yml?branch=main&label=CI)](https://github.com/drew-simmons/lawbook/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/drew-simmons/lawbook?label=release)](https://github.com/drew-simmons/lawbook/releases/latest)
[![Docs](https://img.shields.io/badge/docs-drew--simmons.github.io-blue)](https://drew-simmons.github.io/lawbook/)
[![License](https://img.shields.io/github/license/drew-simmons/lawbook)](LICENSE)

Lawbook checks code standards with repeatable rules and LLM decisions. It is
at an early stage and has no commands yet.

## Install

With Rust 1.88 or newer, from a clone:

```sh
cargo install --path . --locked
```

Once a release exists, `cargo install lawbook --locked` installs it from
crates.io, and the installer downloads a prebuilt binary for macOS or
Linux, checks its SHA-256 checksum, and puts `lawbook` in `~/.cargo/bin`:

```sh
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/drew-simmons/lawbook/releases/latest/download/lawbook-installer.sh \
  | sh
```

## Development

The project uses Rust 1.88.0. Before submitting a change, run:

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets
cargo package --locked --allow-dirty
```

CI also runs [poly-crap](https://github.com/drew-simmons/poly-crap) with a
threshold of `5` and fails the build when a function is over it.
[CLAUDE.md](CLAUDE.md) describes the layout and the rules the code follows.

The docs site lives in `docs/`. Run `pnpm --dir docs install` once, then
`pnpm --dir docs run dev` to serve it locally.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance,
[SECURITY.md](SECURITY.md) for vulnerability reporting, and
[RELEASING.md](RELEASING.md) for maintainer release steps.

## License

MIT
