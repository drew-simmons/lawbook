# Releasing

Release Please manages versions, `package.json`, `CHANGELOG.md`, tags, and
GitHub release notes from Conventional Commits. The `Release` workflow
publishes each release tag to npm.

## One-time GitHub setup

1. Optional: to let Release Please pull requests start CI without manual
   approval, create a fine-grained personal access token scoped only to
   `drew-simmons/lawbook` with these repository permissions:

   - Contents: read and write
   - Issues: read and write
   - Pull requests: read and write

2. Add that token as the repository Actions secret `RELEASE_PLEASE_TOKEN`.
   Release builds do not need this token.
3. In **Settings → Actions → General**, enable **Allow GitHub Actions to create
   and approve pull requests**. The `GITHUB_TOKEN` fallback requires it.
   Without it the `Release Please` workflow fails after pushing its branch.
   Re-run the failed workflow once the setting is on, or let the next push to
   `main` run it; it reuses the branch and re-plans the version from the
   configuration on every run.
4. On npmjs.com, add a trusted publisher for the `lawbook` package: repository
   `drew-simmons/lawbook`, workflow `release.yml`. The workflow then publishes
   without a stored token. npm needs the package to exist first, so publish
   the first version by hand or with a short-lived token.
5. In **Settings → Pages**, set the source to **GitHub Actions**. The `Docs`
   workflow deploys the site.
6. In **Settings → General → Pull Requests**:

   - Disable merge commits.
   - Enable squash merging.
   - Set the default squash commit message to **Pull request title**.
   - Disable rebase merging.
   - Enable automatic deletion of head branches.

7. After the workflows have run for a pull request, create an active ruleset in
   **Settings → Rules → Rulesets** that targets the default branch:

   - Restrict branch deletion.
   - Block force pushes.
   - Require a pull request. Zero approvals is suitable for a solo maintainer.
   - Require linear history.
   - Require these status checks:
     - `Validate PR title`
     - `Format, lint, and package`
     - `Test (ubuntu-24.04)`
     - `Test (macos-14)`
     - `Test (windows-2022)`
     - `CRAP score`

> [!IMPORTANT]
> GitHub does not start tag workflows for tags created with the default
> `GITHUB_TOKEN`. After Release Please creates a tag, its workflow dispatches
> the `Release` workflow with `GITHUB_TOKEN`, which GitHub does allow. A
> dedicated token remains useful for CI on Release Please pull requests.

## Conventional Commits

Use Conventional Commit subjects on commits merged to `main`:

- `fix: ...` creates a patch release.
- `feat: ...` creates a minor release.
- `feat!: ...` or a `BREAKING CHANGE:` footer creates a breaking release.
- `docs:`, `test:`, `ci:`, and `chore:` do not create releases by themselves.

Before version 1.0, breaking changes bump the minor version. Release Please
keeps implementation-only commit types out of the public changelog.

## Automated release flow

1. Push or merge Conventional Commits to `main`.
2. Release Please creates or updates a Release PR with the next version,
   `package.json`, and `CHANGELOG.md` changes.
3. Review its notes and merge the Release PR after CI passes.
4. Release Please creates the version tag and a draft GitHub Release.
5. Release Please starts the `Release` workflow for the tag. It builds and
   tests the package and publishes it to npm with provenance.
6. The workflow then publishes the draft release.

The repository starts at version `0.0.0`. `initial-version` in
`release-please-config.json` fixes the first release at `0.1.0`; without it,
Release Please proposes `1.0.0` for a first release even with
`bump-minor-pre-major`.

> [!IMPORTANT]
> Do not bump the package version, edit generated changelog entries, or create
> release tags by hand. If the `Release` workflow fails before it publishes to
> npm, fix the cause and rerun it in GitHub Actions. The draft release stays
> unpublished.

If Release Please created a tag but the `Release` workflow did not start, run
it from the Actions tab and enter the existing tag. This publishes the draft
without moving or recreating the tag.

Do not move or recreate a published tag, and do not republish an npm version.
Fix released defects with a new patch release.
