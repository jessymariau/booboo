# create-booboo

## 0.5.2

### Patch Changes

- 623cc7c: A one-line GitHub star ask at the two entry commands, placed where the product has just proved itself: the end of the `create-booboo` scaffold output, and `booboo view` in `--demo` mode only — daily snapshot users are never nagged.

## 0.5.1

### Patch Changes

- 2ed5ff1: Point `mcpName` and every package's repo metadata at the current GitHub identity
  (`jessymariau`).

  Jesse's GitHub account was renamed from `jessedu29260-netizen` on 2026-07-26. The MCP
  registry does not migrate namespaces: `io.github.*` publish rights are granted against
  the _current_ GitHub login, so the published entries under
  `io.github.jessedu29260-netizen/booboo` can no longer be edited by their author, and the
  canonical server identity has to move. Republishing requires a new npm version, because
  the registry validates `mcpName` against the **exact** package version named in
  `server.json` and npm versions are immutable — 0.5.1 will forever carry the old name.

  Every package is bumped, not just the CLI, because all eight carry `repository`,
  `homepage` and `bugs` pointing at the old handle. GitHub 301-redirects those today, but
  the redirect breaks the moment anyone claims the abandoned username and creates a repo
  called `booboo` — at which point eight npm package pages would link a stranger's repo as
  Booboo's source.

  Metadata only. No `bin`, `dist/` or runtime path is touched, so `npx @booboo-brain/cli`
  keeps working for existing users at every version.
