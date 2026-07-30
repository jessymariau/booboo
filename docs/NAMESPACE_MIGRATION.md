# Namespace migration — `jessedu29260-netizen` → `jessymariau`

**Status 2026-07-26 BST:** repo prepared (uncommitted diff), nothing published. Steps 1–9 below are Jesse's.

## The finding

The MCP registry does **not** support renaming or migrating a namespace. `io.github.*` publish
rights are minted per-request from the **current GitHub login**, not a stable account ID:

```go
// internal/api/handlers/v0/auth/github_at.go
permissions := h.buildPermissions(user.Login, orgs)
// → ResourcePattern: fmt.Sprintf("io.github.%s/*", username)
```

So as of the 2026-07-26 rename, Jesse's token authenticates as `jessymariau` and has **zero
authority** over the three published versions of `io.github.jessedu29260-netizen/booboo`. He
cannot edit them, cannot deprecate them, cannot delete them.

Registry issue [#1243](https://github.com/modelcontextprotocol/registry/issues/1243) is the
identical case (`KVANTRA-dev` → `Semiotronika`), answered by a registry contributor: republish
under the new namespace; to touch the old entries, temporarily rename the GitHub account back.

Republishing forces a **new npm version**. The registry validates `mcpName` against the exact
package version named in `server.json` (`internal/validators/registries/npm.go` fetches
`/@booboo-brain%2Fcli/<version>` and requires `mcpName == serverName`), and npm versions are
immutable — `@booboo-brain/cli@0.5.1` will carry the old name forever.

## Why an org, not the rename-dance

`gh api users/jessedu29260-netizen` → **404**. The handle is unclaimed *right now*, and GitHub's
user and org namespaces are the same namespace. Creating a **free GitHub Organization** named
`jessedu29260-netizen`:

1. denies the handle permanently, for £0;
2. **restores registry authority over the old namespace** — `buildPermissions` also grants
   `io.github.<org>/*` to org **Owners** (`GET /user/memberships/orgs`, `role=admin`,
   `state=active`, needs `read:org` scope, which Jesse's token already has). So the old entries
   become deprecatable without touching his personal handle at all;
3. keeps the GitHub 301 redirects alive — they only break if a repo named `booboo` is created
   under the claiming account, so **create no repositories in that org**.

This dominates the maintainer's rename-dance, which works once, leaves the handle free
afterwards, and opens a window where `jessymariau` itself is claimable.

Not recommended: a second personal GitHub account to squat the name. ToS B.3 allows one free
personal account plus one free machine account, the latter "only used for running a machine".

## Runbook

**Phase 1 — deny the handle (do this first; it is free and currently unclaimed)**

1. Create a free GitHub Organization named `jessedu29260-netizen`. Create **no repositories** in it.

**Phase 2 — move the canonical identity**

2. Review the prepared diff (`git diff` in this repo — 22 files, metadata + links only), commit,
   open a PR, merge. CI's changeset guard is satisfied by `.changeset/namespace-migration.md`.
3. Merge the auto-opened `chore: version packages` PR. `release.yml` publishes to npm
   (`NPM_TOKEN` is armed).
4. **Verify before publishing to the registry** — the published version must equal the version in
   `server.json` (currently `0.5.2`; `changeset status` confirms cli 0.5.1 → 0.5.2, but check
   reality, not the plan):

   ```bash
   curl -s https://registry.npmjs.org/@booboo-brain/cli/0.5.2 | jq '{version, mcpName}'
   ```

   Expect `mcpName: "io.github.jessymariau/booboo"`. If the version differs, fix `server.json`
   before step 5 — the registry will reject a mismatch.
5. `mcp-publisher validate` → `mcp-publisher login github` (device flow, Jesse authorizes) →
   `mcp-publisher publish`.
6. Verify: `https://registry.modelcontextprotocol.io/v0/servers?search=booboo` shows
   `io.github.jessymariau/booboo` `status=active`, `isLatest=true`.

**Phase 3 — retire the old entries** (needs Phase 1 done, and a token with `read:org`)

7. `mcp-publisher login github`, then:

   ```bash
   mcp-publisher status --status deprecated --all-versions io.github.jessedu29260-netizen/booboo
   ```

   with a status message pointing at the new name.
8. Verify all three old versions report `status=deprecated`.

**Phase 4 — downstream**

9. Re-point Glama (owner field), mcp.so, and awesome-mcp-servers
   [PR #9087](https://github.com/punkpeye/awesome-mcp-servers/pull/9087). PulseMCP auto-ingests
   the registry daily and will follow on its own. Check any Upwork/Contra profile links that
   hardcode the old repo URL.

## What stays exposed

- **Until step 1, the handle is claimable by anyone.** A claimant who creates a repo named
  `booboo` under it breaks every 301 redirect at once — including the `homepage`/`repository`
  links on eight live npm packages and `repository.url` on the three live registry entries.
- **Deprecation is not a security control.** `active → deprecated → active` is a permitted
  transition (`validateStatusTransition` only forbids no-ops and a message on `active`), so
  whoever holds the namespace can revive a deprecated entry.
- **The old npm versions are immutable.** `@booboo-brain/cli@0.1.0`–`0.5.1` permanently declare
  `mcpName: io.github.jessedu29260-netizen/booboo`. A claimant of the handle could therefore
  publish `io.github.jessedu29260-netizen/booboo@0.6.0` that *passes ownership validation* by
  naming `@booboo-brain/cli@0.5.1` — an entry that looks canonical, points at Jesse's real
  package, and whose description, `websiteUrl` and `repository.url` are entirely theirs to set.
  This is the concrete supply-chain exposure, and **only owning the handle closes it.**
