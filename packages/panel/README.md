# @booboo-brain/panel

The [Booboo](https://github.com/jessymariau/booboo) **organigram** — your agent
fleet as a real org chart, where the chart is the **authority**, not a diagram. Drag an
agent under a new parent, hit apply, and the org file changes: validated before every
write (a cycle can never land), versioned in git. Agents that boot with `booboo_boot`
obey the new shape next session.

## Standalone (no React app needed)

```bash
booboo panel --org org.booboo.json [--snapshot brain.json] [--port 8990] [--no-open]
```

The package ships a prebuilt static app (`dist-app/`) that the
[`@booboo-brain/cli`](https://www.npmjs.com/package/@booboo-brain/cli) `panel` command
serves directly. Pass `--snapshot` to light up live memory/report counts on each dossier.

Five tabs over one org file + one snapshot:

| Tab | What it shows |
|-----|---------------|
| **organigram** | the drag-drop hierarchy — every agent a card: rules, skills, buckets, latest reports |
| **buckets** | each memory bucket with live counts and the agents that reach it |
| **reports** | what the fleet closed, newest first, filterable per agent |
| **rules** | who declares each rule, who inherits it (rules inherit top-down) |
| **graph** | the 3D brain, embedded ([`@booboo-brain/viewer`](https://www.npmjs.com/package/@booboo-brain/viewer)) |

Reports and buckets fill two ways: **live**, when an agent calls `booboo_remember` /
`booboo_report` over MCP (durable journal writes, no rebuild), or **in bulk** from your
own tables via config — see the repo's
[docs/CONFIG.md](https://github.com/jessymariau/booboo/blob/main/docs/CONFIG.md).

## As a React component

```bash
npm install @booboo-brain/panel react react-dom
```

```tsx
import { Panel } from "@booboo-brain/panel";

// Standalone default: same-origin /api/*. A host app injects its own backend:
export function OrgPage() {
  return <Panel api={(path, init) => fetch(`/my-backend${path}`, init).then((r) => r.json())} />;
}
```

`Panel` mounts the full five-tab app; the `api` prop (`ApiFn`) routes every read/write so
you can back it with anything that speaks the same `/api/*` shape the CLI serves.

Part of [Booboo](https://github.com/jessymariau/booboo) — the unified operational brain. MIT.
