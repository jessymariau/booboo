# @booboo-brain/mcpb — the MCPB bundle

Booboo's local-install artifact: a single `booboo.mcpb` file that Claude Desktop
installs directly, and that Smithery distributes as a stdio server.

Booboo runs over stdio, so Smithery's URL path does not apply — an MCPB bundle is
the correct distribution shape. See <https://smithery.ai/docs/build/publish>.

## Build

```bash
node packages/mcpb/build.mjs            # bundles the published @booboo-brain/serve
node packages/mcpb/build.mjs 0.5.0      # pin a specific serve version
```

Output: `packages/mcpb/build/booboo.mcpb` (gitignored — it is a release artifact,
not source).

The bundle version tracks `packages/cli/package.json`, because that is the
version users already see on npm and in the MCP registry.

## What is in it, and what is not

Only `@booboo-brain/serve` and its dependencies. The CLI lazy-loads
`build` / `viewer` / `panel` / `vault`, and the MCP entry point never reaches
them — so bundling the whole CLI would ship a 3D viewer to every user for
nothing. Measured: **181 MB** for the full CLI tree versus **9.5 MB unpacked /
3.0 MB packed** for serve alone.

`build.mjs` installs from npm rather than from the pnpm workspace on purpose:
workspace packages are symlinked, and symlinks do not survive being zipped into
a bundle.

## Configuration

The host collects three values and passes them as environment variables. MCPB
interpolates an unset optional `${user_config.*}` to an empty string rather than
dropping it, which is why `src/index.mjs` reads env vars and tests for empty
instead of taking CLI flags — `--org ""` would otherwise reach the loader.

| Setting | Env | Required | Effect |
|---|---|---|---|
| Booboo snapshot | `BOOBOO_SNAPSHOT` | yes | The `graph.json` from `booboo build` |
| Organigram | `BOOBOO_ORG` | no | Adds `booboo_boot` and `booboo_org` |
| Read-only | `BOOBOO_READONLY` | no | Hides `booboo_remember` / `booboo_report` |

`BOOBOO_JOURNAL` overrides the journal path; by default it sits beside the
snapshot, and past writes are replayed on boot.

## Verified

Built and exercised against `examples/pemberton/` on 2026-08-03 (bundle 0.5.2,
serve 0.5.0, node 24):

- `initialize` — OK, protocol `2025-06-18`
- `tools/list` — 10 tools: `booboo_boot`, `booboo_org`, `booboo_stats`,
  `booboo_search`, `booboo_node`, `booboo_count`, `booboo_neighbors`,
  `booboo_path`, `booboo_remember`, `booboo_report`
- `booboo_stats` — 2,839 nodes / 397 links across 4 layers
- `booboo_search`, `booboo_node`, `booboo_neighbors`, `booboo_boot` — all return
  real graph content
- stdout carries JSON-RPC only; the startup banner goes to stderr
- read-only mode drops the write tools; a missing snapshot exits 1 with a
  message naming the setting to fix

## Publish

Requires a Smithery account and namespace.

```bash
npx -y @smithery/cli login
npx -y @smithery/cli mcp publish packages/mcpb/build/booboo.mcpb -n <namespace>/booboo
```
