# Booboo — public launch checklist

> The gate. Booboo does **not** go public (GitHub public / npm publish / any marketing) until every **P0** below is resolved and the Go-live gate passes. Grounded in a real audit + run of the code on 2026-06-23. Status: ☐ todo · ◐ in progress · ☑ done.

## Status at a glance
- **What works (verified):** `booboo build` (json + config), `booboo serve` (all routes), MCP server compiles + tests pass, `create-booboo` scaffolds a project that builds + serves. `pnpm build` + `pnpm test` (9/9) green.
- **What blocks public:** nothing is published to npm, so the advertised `npx` flow can't install; repo isn't public. *(The 3D viewer is now reachable — `booboo view` — the CLI is unified, and docs are reconciled to reality as of 2026-07-02.)*

---

## P0 — blockers (must clear before public)

- ☑ **P0.1 · npm publish chain — DONE (2026-07-02).** All packages are live on the public registry under `@booboo-brain/*` (plus unscoped `create-booboo`); each carries its own semver — see the per-package `package.json` / npm, not a single frozen version here. Stage B clean-install gate re-run against the REAL registry: **ALL GREEN in 23s** (scaffold→install→build→REST→view→MCP in a clean node:20 container). Gotcha for posterity: a brand-new org scope takes ~15 min to propagate (404s on GET while `+ published` succeeds — don't panic-republish). Original dress rehearsal below.
- *(history)* ◐ P0.1 dress rehearsal — `stress/clean-install.sh` publishes all six packages to a throwaway Verdaccio (via `pnpm publish`, which converts `workspace:*` — never `npm publish` here) and runs the full first-user journey in a clean `node:20` container: scaffold → install → build (7-node starter) → REST (`/stats /graph /search`) → `booboo view` (302 + app + snapshot) → MCP initialize. **ALL GREEN in 29s.** Scope note (2026-07-02): the `booboo` npm org name was taken — packages live under **@booboo-brain** (org created, Jesse-owner); `create-booboo` stays unscoped. Remaining: publish for real `spec → build → serve → viewer → cli` (create-booboo@0.1.0 already live), then re-run the identical gate against the real registry: `REGISTRY=https://registry.npmjs.org ./stress/clean-install.sh --no-publish`.
- ☑ **P0.2 · Docs match reality (no vaporware) — DONE (2026-07-02).** SCALE.md rewritten around what ships (`booboo view --demo --nodes N` + the viewer playground `?n=`); the coherent `booboo demo` generator, GPU picking, streaming, and weak-GPU fallback are now explicitly labelled Roadmap. README status line lists all six packages; `@booboo-brain/cli` README no longer says view is "coming soon".
- ☑ **P0.3 · End-user viewer path — DONE (2026-06-25).** `booboo view --snapshot brain.json` serves the prebuilt `@booboo-brain/viewer` static app + the snapshot locally and opens the browser (`--demo [--nodes N]` for a no-data synthetic brain). Wired into the `create-booboo` scaffold as `npm run view`. Verified end-to-end: scaffold → `booboo build` → `booboo view` renders the 3D brain in Chrome (7 nodes / 8 links / 3 layers, 0 console errors), path-traversal guarded. The viewer's static bundle is self-contained, so the CLI runtime stays stdlib.
- ☑ **P0.4 · Repo public + pushed — DONE (2026-07-02, Jesse go).** https://github.com/jessymariau/booboo · first CI run green in 35s.
- ☑ **P0.5 · Final pre-publish secret/scan — CLEAN (2026-07-02).** Full-history (`git log -p --all`) + working-tree sweep for `sk-` / `sbp_` / `eyJ` JWTs / `password=` / `postgres[ql]://user:pass@` / `AKIA` / `ghp_` / `xoxb`: zero real secrets; the only hit is the placeholder `postgres://USER:PASS@HOST` comment in `examples/dionisos.config.yaml` (which reads `${DATABASE_URL}` from the env). The private `dionisos.booboo.json` snapshot + local screenshots/verify scripts were moved out of the repo folder (they were gitignored and never committed). Kept `examples/dionisos.config.yaml` as the "proven on a real system" demo — schema names only, no data.

## P1 — correctness issues found in the audit

- ☑ **P1.1 · Layer union — fixed (2026-06-23).** `build` now unions every node's layer into `meta.layers` (auto-adds any missing layer + warns on stderr).
- ☑ **P1.2 · `output.db_table` removed (2026-06-23).** Was declared-but-unimplemented; dropped from the config type + docs. A live single-row DB output is now a P5/roadmap feature (needs a proper `output.db_url` + schema).
- ☑ **P1.3 · Dangling-link drops now warned (2026-06-23).** `build` logs `dropped N dangling link(s)` to stderr (TROUBLESHOOTING covers the prefix foot-gun).
- ☑ **P1.4 · Postgres adapter verified live (2026-06-23).** Ran `examples/dionisos.config.yaml` against the real Dionisos Supabase (pooler `:6543`) → built 4,507 nodes (agents:11 · families:11 · memory:4,485) + 21 links, walls applied, clean. (A CI integration test against a throwaway DB is still nice-to-have — see P2.4.)
- ☑ **P1.5 · CLI shape — LOCKED (2026-06-25): unify.** One `booboo` bin (from new `@booboo-brain/cli`) dispatches `build | serve | mcp | view`, lazy-loading each subcommand so a build-only run never pulls the server. The old split bins (`booboo` on build, `booboo-serve` on serve) are gone. README, scaffold, and docs updated in lockstep. (`booboo view` is a stub until the viewer release — P0.3.)

## P2 — packaging / OSS hygiene

- ☑ **P2.1 · Version bump** — packages published; each on its own per-package semver (see each `package.json` / npm — no single pinned version). (Publishing them = P0.1, Jesse-gated.)
- ☑ **P2.2 · README status line — DONE (2026-07-02).** Now reads "six packages build green" and names all six.
- ☑ **P2.3 · Per-package READMEs — DONE (2026-07-02; completed to eight 2026-07-16).** All six then-published packages had one (spec, viewer, create-booboo written that pass; build/serve/cli already had them; cli's refreshed). `panel` + `vault` (added later) got theirs 2026-07-16 — their npm pages were blank until the next publish carries them.
- ☑ **P2.4 · CI** — `.github/workflows/ci.yml` runs frozen-install + `pnpm build` + `pnpm test` + a create-booboo scaffold smoke on push/PR. Every step verified locally; the live run fires once the repo is public (P0.4).
- ☑ **P2.5 · `create-booboo` smoke test** — encoded in ci.yml (scaffold → `booboo build` → assert a non-empty snapshot).
- ☑ **P2.6 · Repo URL — DONE (2026-07-02).** All placeholder links filled with `https://github.com/jessymariau/booboo`; every `packages/*/package.json` (and the root) now carries `repository` (with per-package `directory`), `bugs`, and `homepage`.
- ☑ **P2.7 · `ssl: rejectUnauthorized:false` — DONE (2026-07-12).** Non-local Postgres now defaults to `rejectUnauthorized: true`; `BOOBOO_PG_INSECURE_TLS=1` is the explicit opt-in for self-signed/internal Postgres.
- ☑ **P2.8 · CONTRIBUTING.md + issue templates — DONE (2026-07-02).** `CONTRIBUTING.md` (pnpm setup, build/test, PR expectations, code style) + `.github/ISSUE_TEMPLATE/bug_report.md` + `feature_request.md`; `ci.yml` YAML-validated.

## Deliverables — documentation

- ☑ **CONFIG reference** → `docs/CONFIG.md`
- ☑ **Troubleshooting** → `docs/TROUBLESHOOTING.md`
- ☑ **Spec** → `SPEC.md` · **Architecture/blueprint** → `BLUEPRINT.md` · **Scale story** → `SCALE.md` (reconciled 2026-07-02)
- ☑ **README** — install/usage reconciled to reality; six-package status line, all commands verified against the CLI (2026-07-02)
- ☐ **HOW_IT_WORKS** — covered by README "the one idea" + BLUEPRINT; expand to a standalone page only if needed
- ☑ **MCP client setup — DONE (2026-07-16).** README § "Connect it to Claude / Cursor (MCP)" carries the copy-paste `mcpServers` block (Claude Desktop / Cursor / Claude Code paths named inline) since 4b3277b; scaffold README repeats the pointer.

## "Config we sell" — parity

- ☐ The £29 AI Core Drop config + the done-for-you/hosted config must be the **same `booboo.config.yaml` schema** end users get from `create-booboo`. Keep one schema; the drop is a filled-in config + master prompt, not a fork. (Tracked with BOOBOO-PIVOT-04.)
- ☐ Troubleshooting + CONFIG docs are written against the **shipping** schema (done) and must be updated in lockstep if the schema changes.

---

> **Gate #2 re-verified 2026-07-16 (BST)** against the real registry on Windows 11: `npx -y create-booboo@latest` → `npm install` → `build` (7 nodes, quality line) → `serve` (`/stats /search /path` all correct) → `mcp` (initialize + 9 tools; `booboo_boot` returns the boot slice; `booboo_remember` write persisted to `brain.journal.jsonl` and was found by `booboo_search` in a NEW session) → `view` (302 → app + snapshot 200, journal merged) → `panel` (200, 3 agents) → `vault` (18 pages). Zero failures.

## Go-live gate (all must be true)
1. Every **P0** ☑ and every **P1** ☑ (or consciously deferred with a written reason).
2. `npx create-booboo my-brain` on a **clean machine** → `npm install && npm run build && npm run serve` works from the **published** registry.
3. The postgres path is proven against a real database.
4. An end user can **see the 3D brain** without cloning the monorepo.
5. CI is green; docs contain no claim the code can't back up.
6. Jesse's explicit go on making the repo public.

## Order of operations
P1 fixes → docs reconcile (P0.2) → viewer path (P0.3) → CLI lock (P1.5) → version bump + CI (P2) → npm publish (P0.1) → clean-machine re-verify → **repo public (P0.4)** → marketing / the £29 drop.
