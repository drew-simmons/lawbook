# Contributing

Thank you for helping improve `lawbook`.
Use a GitHub issue to report a bug or suggest a change. Open a pull request when
you have a tested fix.

## Development setup

1. Install Node.js 24 using `mise` or another version manager, and pnpm.
2. Install prek 0.4.12:

   ```sh
   uv tool install prek==0.4.12
   ```

3. Clone the repository:

   ```sh
   git clone https://github.com/drew-simmons/lawbook.git
   cd lawbook
   ```

4. Install the dependencies and the Git hook:

   ```sh
   pnpm install
   prek install
   ```

5. Run the hooks and build the npm package:

   ```sh
   prek run --all-files
   pnpm pack --dry-run
   ```

The hook runs repository checks, oxlint, oxfmt, the type checker, and the test
suite.
The matching commands are:

```sh
pnpm run lint
pnpm run typecheck
pnpm test
```

> [!IMPORTANT]
> Tests must not require network access, private credentials, or changes to a
> developer's system. Keep outside process and network work in small units that
> tests can replace.

## Docs site

The documentation site under `docs/` is built with
[Blume](https://useblume.dev) and needs Node.js 22.12 or newer and pnpm. Run
it locally with:

```sh
pnpm --dir docs install
pnpm --dir docs run dev
```

Before you open a pull request that touches `docs/`, run
`pnpm --dir docs run build` and `pnpm --dir docs run validate`. The `Docs`
workflow runs the same two commands and deploys `main` to GitHub Pages.

## Commit messages

Use Conventional Commit subjects because release automation derives versions
and release notes from commits merged to `main`:

```text
fix: handle an empty input file
feat: add JSON output
feat!: change the command output
```

Use `fix:` for bug fixes, `feat:` for features, and `!` or a
`BREAKING CHANGE:` footer for incompatible changes. Types such as `docs:`,
`test:`, `ci:`, and `chore:` do not trigger a release by themselves.

> [!TIP]
> The pull request title should follow this format. The project uses squash
> merges, so that title becomes the commit subject on `main`.

## Pull requests

- Keep changes focused and explain their user-visible effect.
- Add tests for new behavior and fixed bugs.
- Update the docs under `docs/content/` and the README when commands, options,
  or requirements change.
- Do not commit credentials, generated build output, or local tool state.

Before you open a pull request, run both checks from the setup steps and
describe any check you could not run.

By contributing, you agree that your contributions are licensed under the MIT
License.
