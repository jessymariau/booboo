# MCP directory submissions — booboo

Status of getting `booboo mcp` listed across the MCP ecosystem. Prereq (done): the
README carries a copy-paste **Connect it to Claude / Cursor (MCP)** config block, install
steps, usage, and MIT license — every directory below wants exactly that.

Repo: `https://github.com/jessymariau/booboo` · npm: `@booboo-brain/cli` (`booboo mcp`).

Every one of these needs Jesse's logged-in account or a PR under his name — none can be
fired autonomously. Do them in one guided pass (Claude drives Chrome; Jesse authenticates).

| # | Directory | How to submit | Needs | Status |
|---|-----------|---------------|-------|--------|
| 1 | **punkpeye/awesome-mcp-servers** | PR (already open) | GitHub | ✅ [PR #9087](https://github.com/punkpeye/awesome-mcp-servers/pull/9087) — OPEN, awaiting merge |
| 2 | **Glama.ai** | "Add server" form → GitHub OAuth, they verify repo admin + auto-index | GitHub login (repo owner) | ✅ **LIVE 2026-07-11** — approved + indexed (quality **B**, MIT); [glama.ai/mcp/servers?query=booboo](https://glama.ai/mcp/servers?query=booboo). Approval email received. |
| 3 | **Smithery.ai** | now **remote-only**: the Publish form (`/servers/new`) takes only an HTTPS **MCP Server URL** it proxies via its gateway | a hosted HTTPS endpoint | ⛔ **NOT A FIT (2026-07-11)** — Booboo is local-stdio (reads your private brain files); no endpoint to hand over. Skip, or later deploy a hosted *demo* instance (needs HTTP transport in `serve` + a public URL) purely for the Smithery playground. Jesse's call. |
| 4 | **mcp.so** | Submit form → paste public GitHub repo URL → auto-drafts from README → save publishes | GitHub-connected mcp.so account | ✅ **LIVE 2026-07-11** — [mcp.so/servers/booboo](https://mcp.so/servers/booboo) · category Memory & Knowledge · homepage fractionalhq.uk |
| 5 | **PulseMCP** | **no direct submit / no login**: PulseMCP **ingests from the Official MCP Registry daily** (`hello@pulsemcp.com` for edits) | nothing — downstream of #6 | ✅ **LIVE (auto-ingested)** — confirmed on [pulsemcp.com](https://www.pulsemcp.com/servers?q=booboo) (Booboo · jessedu29260-netizen · Community). Ingested the Jul-5 registry entry with zero action; the 0.4.0 refresh follows on its next daily pull. |
| 6 | **Official MCP Registry** (registry.modelcontextprotocol.io) | `mcp-publisher` CLI reads `server.json` → `login github` (device flow) → `publish` | GitHub auth (repo owner) + `mcp-publisher` binary | ✅ **LIVE at 0.4.0** — published 2026-07-11 19:09 BST via `mcp-publisher` v1.7.9 (bumped from the 0.3.1 that had been there since Jul 5). Verified on the registry API: `status=active`, `isLatest=true`. This is the source that feeds PulseMCP + aggregators. |

Notes:
- No `server.json` needed for any of these — Glama infers the schema from the repo, the
  official Registry uses the YAML PR. Only Smithery wants its own `smithery.yaml`, added
  when we run its CLI (kept out of the repo until then — nothing speculative).
- All six want the same thing that already exists: a clean public repo + README MCP block +
  npm package. The remaining work is purely the authenticated submit step per site.
- **2026-07-04 audit:** booboo is NOT live on Glama (search + direct slug both empty) — the
  Jul-3 submission never indexed; redo it first. PR #9087 carries the `missing-glama`
  label, so **Glama is the gate for the whole chain**. Order of the guided pass:
  Glama → (label clears / re-trigger) → Smithery → mcp.so → PulseMCP → official registry.
- **2026-07-11 re-submit (Frankie + Jesse, guided pass):** verified booboo still NOT on Glama
  (search "booboo" → only unrelated `booboooking`; empty match list). Jesse signed into Glama via
  GitHub (jessedu29260-netizen, repo owner); Claude drove the **Add Server → Server tab** form:
  Name `Booboo`, repo `https://github.com/jessymariau/booboo`, 2-sentence MCP-forward
  description. **Submit for Review accepted** (dialog closed, no validation error). Glama reviews
  before public, so it is NOT yet searchable and the direct slug 404s — that is expected pending
  state, not a failure. Glama exposes no submitter-side "my submissions" view to confirm from.
  **WATCH:** (a) `glama.ai/mcp/servers?query=booboo` for booboo to appear (hours–days), then
  (b) the red `missing-glama` label on [PR #9087](https://github.com/punkpeye/awesome-mcp-servers/pull/9087)
  should auto-clear → PR mergeable (comment to re-trigger the bot if it lingers after Glama indexes).
  Only THEN proceed down the chain: Smithery → mcp.so → PulseMCP → official registry.
- **2026-07-11 evening — GLAMA LIVE ✅ (milestone):** approval email from Glama; verified on
  `glama.ai/mcp/servers?query=booboo` — Booboo listed (owner `jessedu29260-netizen`, quality **B**,
  MIT, correct description). **The Glama gate is cleared.** PR #9087 `missing-glama` label is still
  on as of ~18:30 BST (maintainer bot hasn't re-evaluated since indexing) — if it lingers >24h,
  comment on the PR to re-trigger the bot (Jesse-gated public write). Routing task
  `booboo-mcp-dir-next` filed (owner=both, P2) → next guided pass: Smithery → mcp.so → PulseMCP → registry.
- **2026-07-11 evening — directory pass ran (Frankie + Jesse), chain re-mapped:** the ecosystem moved since
  the Jul-4 notes. **mcp.so is LIVE** ([mcp.so/servers/booboo](https://mcp.so/servers/booboo)). **Smithery** is now a
  remote-gateway (HTTPS-URL only) — a dead end for a local-first tool, parked as Jesse's call (skip vs hosted demo).
  **PulseMCP** has no submit form / no login — it auto-ingests from the **Official MCP Registry**. So the real order
  collapses to: **Official Registry is the linchpin** (feeds PulseMCP + others). Booboo is publish-ready there —
  `server.json` valid + bumped to 0.4.0, published `@booboo-brain/cli@0.4.0` carries `mcpName`, so no npm republish.
  Remaining: `mcp-publisher login github` (Jesse device-flow) + `publish`. Then PulseMCP follows automatically.
- **2026-07-11 ~20:09 BST — REGISTRY PUBLISHED + PulseMCP confirmed (DONE):** fetched `mcp-publisher` v1.7.9
  (win amd64), `validate` ✅, Jesse authorized the GitHub device flow (code 29F7-C87F), `publish` ✅ →
  `io.github.jessedu29260-netizen/booboo` **0.4.0** live (superseded the Jul-5 0.3.1). Verified via the registry
  API (`status=active`, `isLatest=true`). Then confirmed **PulseMCP already lists Booboo** (auto-ingested the
  Jul-5 entry) — so #5 and #6 are both DONE. **Live coverage now: Glama · mcp.so · PulseMCP · Official Registry.**
  Open: awesome-mcp-servers PR #9087 (missing-glama label, pending bot re-eval). Not pursuing: Smithery (remote-only).
- **2026-07-26 — GitHub handle renamed `jessedu29260-netizen` → `jessymariau`.** Older entries above
  keep the old handle because that is what was true on the day; the repo's own links and
  `server.json` / `mcpName` were rewritten to `jessymariau`. The registry namespace does **not**
  migrate — `io.github.*` publish rights are granted against the *current* GitHub login
  (`buildPermissions(user.Login)` → `io.github.<login>/*`), so the three published versions under
  `io.github.jessedu29260-netizen/booboo` are, as of the rename, outside Jesse's control. Republish
  under `io.github.jessymariau/booboo` is the only supported path (registry issue
  [#1243](https://github.com/modelcontextprotocol/registry/issues/1243) is the same case, answered by
  a maintainer). **Downstream directories still carry the old handle and need re-pointing after the
  republish:** Glama (owner field), PulseMCP (auto-ingests the registry — will follow the new entry),
  mcp.so, and awesome-mcp-servers PR #9087.

## Paste-ready copy (one guided pass — Claude drives, Jesse authenticates)

**Name:** Booboo
**Repo:** `https://github.com/jessymariau/booboo`
**npm:** `@booboo-brain/cli` (+ spec/build/serve/viewer/panel, `create-booboo`)
**License:** MIT · TypeScript · runs locally, cross-platform

**One-liner (short fields):**
> Open-source operational brain — fuse your AI system's agents, memory, knowledge and automations into one rooted, privacy-walled graph served over MCP, with a million-node 3D viewer and a drag-drop organigram your agents boot from.

**Description (longer fields):**
> Booboo turns any AI system's data into one queryable brain: adapters (postgres/json) emit a tiny JSON spec; consumers render/serve it — 3D viewer (60fps at a million nodes), REST, MCP (stats · search · node dossiers · neighbors · pathfinding), and an editable org chart with per-agent contracts, memory buckets, reports and health lights. Privacy walls are applied before emit. MIT, local-first, `npx create-booboo` to scaffold.

**Tags:** knowledge-graph · memory · agents · visualization · orchestration

**MCP config (verbatim from README):**
```jsonc
{
  "mcpServers": {
    "booboo": {
      "command": "npx",
      "args": ["-y", "@booboo-brain/cli", "mcp",
               "--snapshot", "my.booboo.json", "--org", "org.booboo.json"]
    }
  }
}
```

**smithery.yaml draft (add to repo only when running the Smithery step):**
```yaml
startCommand:
  type: stdio
  commandFunction: |
    (config) => ({
      command: "npx",
      args: ["-y", "@booboo-brain/cli", "mcp", "--snapshot", config.snapshot, "--org", config.org]
    })
  configSchema:
    type: object
    required: [snapshot]
    properties:
      snapshot: { type: string, description: "Path to the booboo graph snapshot (my.booboo.json)" }
      org: { type: string, description: "Optional path to the org file (org.booboo.json)" }
```
