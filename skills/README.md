# Booboo skills

Agent skills for working with Booboo brains. Cross-agent — Claude Code, Codex,
Cursor, Copilot and anything else that reads the Agent Skills format.

The MCP server ([`booboo mcp`](../README.md#connect-it-to-claude--cursor-mcp))
lets an agent **query** a brain. These skills teach it to **build, shape and
operate** one.

## Install

```bash
npx skills add jessymariau/booboo
```

Or copy the directories you want into your agent's skills folder:

| Agent | Path |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Codex / generic | `~/.agents/skills/` |
| Copilot CLI | `~/.copilot/skills/` |

## The pack

| Skill | Load it when |
|---|---|
| **`booboo`** | Entry point. What Booboo is, all six commands, all ten MCP tools, and routing to the rest. Start here. |
| **`booboo-deploy`** | Standing a brain up end to end — scaffold, config, build, then REST + MCP + viewer + panel. |
| **`booboo-org`** | Designing or reshaping the agent organigram. The onboarding ritual, rule inheritance, buckets, reparenting. |
| **`booboo-query`** | Consuming a brain over MCP or REST. Boot first, search before fetch, neighbors versus path, writing back. |
| **`booboo-adapter`** | Feeding in data the built-in postgres/json adapters do not cover. A small file against the spec, never a fork. |
| **`booboo-vault`** | Markdown/Obsidian emission, authoring `[[wikilinks]]`, and reading the ingestion quality gate. |
| **`booboo-troubleshoot`** | A build that exits clean and produces nothing, a flat starburst, missing tools, climbing orphans. |

Every skill inherits [`RULES.md`](RULES.md) — the operator rules. Read it once per
session before writing to anyone's brain.

## How this relates to `AGENTS.md`

Two contracts, deliberately separate, and they must not be merged or copied
between:

- **`AGENTS.md`** ships inside a scaffolded brain (imported by that project's
  `CLAUDE.md`). It governs an agent **authoring within its own brain** — boot from
  the org, one atomic fact per note, author your links, corrections replace,
  respect the walls, watch the quality gate, close honestly. It is that system's
  constitution, versioned next to its org, and its owner edits it as their
  conventions evolve.
- **This pack** governs **operator-side** work: building brains, shaping orgs,
  writing adapters, deploying for someone else.

Where both apply to the same folder, **the project's `AGENTS.md` wins.**

## Positioning, for anything you write about Booboo

Booboo is **the org-chart layer for agent fleets**. That is the claim.

It is not a memory store — that category is crowded and it is not the axis Booboo
wins on. Memory is a feature of the org, not the product. The novel part is
operational fusion: wiring, knowledge, episodic memory, agents and crons in one
rooted, live, **bootable** brain that is simultaneously a view, an API and an MCP
source.

Alpha means alpha. Cite the real proof points — a 4,469-node production brain
assembled from Postgres by config alone, and a million-node synthetic render at
60fps — rather than adjectives.

MIT, and it stays MIT. The paid tiers at
[fractionalhq.uk](https://fractionalhq.uk/#tiers) buy setup time, never capability.
