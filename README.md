# lawbook

[![CI](https://img.shields.io/github/actions/workflow/status/drew-simmons/lawbook/ci.yml?branch=main&label=CI)](https://github.com/drew-simmons/lawbook/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/drew-simmons/lawbook?label=release)](https://github.com/drew-simmons/lawbook/releases/latest)
[![Docs](https://img.shields.io/badge/docs-drew--simmons.github.io-blue)](https://drew-simmons.github.io/lawbook/)
[![License](https://img.shields.io/github/license/drew-simmons/lawbook)](LICENSE)

Lawbook checks code standards with repeatable rules and LLM decisions. It is
at an early stage and has no commands yet.

## Install

Lawbook needs Node.js 22.12 or newer. From a clone:

```sh
pnpm install
pnpm run build
npm install --global .
```

Once a release exists, install it from npm:

```sh
npm install --global lawbook
```

## Development

The project uses Node.js 24 and pnpm. Before submitting a change, run:

```sh
pnpm run lint
pnpm run typecheck
pnpm test
pnpm pack --dry-run
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
