# @booboo-brain/vault

Emit a [Booboo](https://github.com/jessymariau/booboo) brain as a **wiki-linked
markdown vault** (Obsidian-compatible). A database is queryable — files are **readable
and portable**: a human can browse the brain on a couch, and any agent from any provider
can read it with zero infrastructure. Emit it nightly and the vault doubles as your
insurance copy.

## CLI

```bash
booboo vault --snapshot brain.json [--org org.booboo.json] [--out vault]
```

What you get:

- **one page per node** — frontmatter (id, type, layer, weight) + every link, both directions
- **index (MOC) pages** per layer and per cluster — the whole brain navigable from `index.md`
- **an agent dossier per org member** (with `--org`) — chain of command, inherited rules, buckets
- `[[wikilinks]]` throughout, alias form `[[page|label]]` — Obsidian resolves them by filename

The vault is **derived**: regenerate it, never hand-edit (`.gitignore` it — the scaffold
already does). Live journal writes (`booboo_remember` / `booboo_report`) are merged in,
so the vault reflects everything the fleet knows.

## API

```ts
import { emitVault } from "@booboo-brain/vault";

const r = emitVault(graph, org, { out: "vault" });
// → { dir: "vault", pages: 18, layers: 3, agents: 3 }
```

`VaultOptions`: `out` (target dir) · `clean` (wipe first, default `true`) ·
`maxPerCluster` (cap node pages per cluster, `0` = no cap; MOCs always list everything).

Part of [Booboo](https://github.com/jessymariau/booboo) — the unified operational brain. MIT.
