# @booboo-brain/serve

## 0.5.0

### Minor Changes

- 6db24bd: `runMcp` accepts an optional `transport`, and the MCP face finally has tests.

  The MCP server is what every desktop client and all five directory listings
  actually reach, and it had **no test at all** — `runMcp` was the one exported
  surface nothing exercised. That is load-bearing right now: the namespace
  republish bumps `@modelcontextprotocol/sdk` from `^1.12.0` to `^1.29.0`, and
  `server.tool()` is already `@deprecated` in 1.29 in favour of `registerTool`.
  The day it is removed, tool registration returns nothing, every listed
  directory serves a brainless server, and the whole suite still passes.

  `transport` defaults to stdio, so `booboo mcp` and every existing consumer are
  unchanged. It exists because the server needs a seam to be driven in-process —
  and because the demo site's Streamable-HTTP `/mcp` is a _second implementation_
  of these ten tools today, which is GAPS C29/C33 waiting to happen again.

  Nine tests assert the contract rather than the implementation: which tools
  register against the installed SDK, that the org tools appear only with an org
  and the write tools only with a writer (a read-only server must stay
  read-only), that every tool carries a description, and what `booboo_stats`,
  `booboo_search`, `booboo_boot` and `booboo_remember` actually answer —
  including that `booboo_boot` returns inherited rules **ancestors-first**, which
  is the contract agents boot on, and that an unknown agent is answered rather
  than thrown.

  Proven by breaking it: renaming one tool failed three tests with a readable
  diff (`+ booboo_find_BREAKME` / `- booboo_search`) and exit 1.

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

- Updated dependencies [2ed5ff1]
  - @booboo-brain/spec@0.3.2
