# create-booboo

Scaffold a runnable [Booboo](https://github.com/jessymariau/booboo) brain in one
command. Zero dependencies, pure stdlib.

## Use

```bash
npx create-booboo my-brain
cd my-brain
npm install
npm run build      # booboo.config.yaml → brain.json (the snapshot)
npm run serve      # REST API on http://localhost:8787
npm run mcp        # MCP over stdio — point Claude / Cursor / Claude Code at it
npm run view       # see your brain in 3D (opens your browser)
```

## What you get

- **`booboo.config.yaml`** — layers, privacy walls, and sources: a JSON starter that works
  immediately, plus a commented postgres block to point at your own Postgres/Supabase
  (`${DATABASE_URL}` from the environment).
- **`data.booboo.json`** — a small sample graph (agents / knowledge / memory) to build from.
- **`package.json`** — wired `build` / `serve` / `mcp` / `view` scripts on `@booboo-brain/cli`.
- **`.gitignore`** — the built snapshot can contain real data, so it's never committed.

Pass `--force` to scaffold into a non-empty directory.

Part of [Booboo](https://github.com/jessymariau/booboo) — the unified operational brain. MIT.
