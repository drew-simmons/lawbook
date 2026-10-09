# lawbook

[![CI](https://img.shields.io/github/actions/workflow/status/drew-simmons/lawbook/ci.yml?branch=main&label=CI)](https://github.com/drew-simmons/lawbook/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/drew-simmons/lawbook?label=release)](https://github.com/drew-simmons/lawbook/releases/latest)
[![Docs](https://img.shields.io/badge/docs-drew--simmons.github.io-blue)](https://drew-simmons.github.io/lawbook/)
[![License](https://img.shields.io/github/license/drew-simmons/lawbook)](LICENSE)

Lawbook checks a directory against the rules in its `lawbook.yaml`: regular
expressions that files must or must not match, paths that must or must not
exist, and standards written in prose that a model judges file by file or as a
set. A failing rule names the file and the reason, and the exit code says
whether the check passed.

```sh
npm install --global lawbook
lawbook init      # writes a starter lawbook.yaml
lawbook check     # exit 0 pass, 1 a rule failed, 2 could not run
lawbook test      # judges each standard rule's example files
```

```yaml
version: 1
rules:
  - id: no-console
    files: ["src/**/*.ts"]
    forbid: 'console\.(log|debug)\('
  - id: has-readme
    exists: README.md
  - id: errors-are-actionable
    files: ["src/**/*.ts"]
    standard: Every error message says what went wrong and what to do next.
```

`standard` rules run the installed Claude Code CLI by default, so a Claude
subscription pays; `provider: codex` or `provider: kiro` runs the Codex or
Kiro CLI instead. `check --no-llm` skips them. The
[docs](https://drew-simmons.github.io/lawbook/) describe the
[configuration format](https://drew-simmons.github.io/lawbook/configuration),
[LLM rules](https://drew-simmons.github.io/lawbook/llm-rules),
[providers](https://drew-simmons.github.io/lawbook/providers), the
[commands](https://drew-simmons.github.io/lawbook/commands), and the
[exit codes](https://drew-simmons.github.io/lawbook/exit-codes). The
[clean-code example](https://drew-simmons.github.io/lawbook/examples), also at
`examples/clean-code.lawbook.yaml`, is a drop-in config built from ten
software engineering books.

## Agent skill

`skills/lawbook/SKILL.md` teaches a coding agent such as Claude Code to run
lawbook, read its findings, and write or tune a `lawbook.yaml`. Copy the
`skills/lawbook` directory into `.claude/skills/` in a project, or into
`~/.claude/skills/` for every project, and the agent picks it up.

## Install

Lawbook needs Node.js 22.12 or newer.

```sh
npm install --global lawbook
```

Or from a clone:

```sh
pnpm install
pnpm run build
npm install --global .
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
