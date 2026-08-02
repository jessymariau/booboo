#!/usr/bin/env node
// create-booboo — scaffold a runnable Booboo brain (config + sample data + wired scripts).
// Zero dependencies; pure stdlib. `npx create-booboo my-brain [--force]`.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BOOBOO_VERSION = "^0.5.0"; // @booboo-brain/* range the scaffolded project depends on (write-back memory: remember/report). Keep the minor in sync with @booboo-brain/cli.
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const dirArg = args.find((a) => !a.startsWith("--")) ?? "my-brain";
const force = flags.has("--force");

if (flags.has("--help") || flags.has("-h")) {
  console.log("usage: npx create-booboo <dir> [--force]\n  scaffolds a runnable Booboo brain (json starter + postgres upgrade path)");
  process.exit(0);
}
if (flags.has("--version") || flags.has("-v")) {
  console.log(VERSION);
  process.exit(0);
}
const KNOWN_FLAGS = new Set(["--force", "--help", "-h", "--version", "-v"]);
const unknownFlags = [...flags].filter((f) => !KNOWN_FLAGS.has(f));
if (unknownFlags.length) {
  console.error(`✗ unknown flag(s): ${unknownFlags.join(", ")}\n  usage: npx create-booboo <dir> [--force]`);
  process.exit(1);
}

const dir = path.resolve(process.cwd(), dirArg);
const name = path.basename(dir);
const TITLE = name.replace(/[-_]/g, " ").toUpperCase();

if (existsSync(dir) && readdirSync(dir).length && !force) {
  console.error(`✗ "${dirArg}" exists and is not empty — pass --force to scaffold anyway.`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const configYaml = `# ${name} — Booboo build config. Docs: SPEC.md + CONFIG.md in the booboo repo.
title: "${TITLE}"
root: { id: core, type: root, label: "${TITLE}" }

# The stacked planes (Z-order = array order). Use whatever layers fit YOUR system.
layers:
  - { name: agents,    color: "#c9a04a", label: "AGENTS" }
  - { name: knowledge, color: "#4ECDC4", label: "KNOWLEDGE" }
  - { name: memory,    color: "#a78bd0", label: "MEMORY" }

# Namespaces that must NEVER be emitted (filtered in the builder, before JSON/API/MCP).
walls: [private, sealed]

# Parse [[wikilinks]] in node text into first-class \`authored\` edges — the links
# a writer CHOSE while understanding the source outrank any harvested relation.
wikilinks: true

sources:
  # 1) JSON starter — works immediately, no database. Edit data.booboo.json.
  - adapter: json
    path: ./data.booboo.json

  # 2) Your real data — uncomment and point at a Postgres/Supabase DB.
  #    Each \`nodes\` entry maps a table → a layer; \`weight_from\` reads a numeric column.
  # - adapter: postgres
  #   url: \${DATABASE_URL}            # postgres://… (read from the environment)
  #   nodes:
  #     - { table: agents,       layer: agents,    id: slug, label: name, parent: core, weight: 0.6 }
  #     - { table: observations, layer: memory,    id: id,   label: title, cluster: project }
  #     - { table: kg_entities,  layer: knowledge, id: id,   label: name, weight_from: degree }
  #   links:
  #     - { table: edges, source: src, target: dst, type: rel }

output:
  snapshot: ./brain.json
`;

const dataJson = JSON.stringify(
  {
    booboo: "1.0",
    meta: {
      root: "core",
      title: "Sample Brain",
      layers: [
        { name: "agents", color: "#c9a04a", label: "AGENTS" },
        { name: "knowledge", color: "#4ECDC4", label: "KNOWLEDGE" },
        { name: "memory", color: "#a78bd0", label: "MEMORY" },
      ],
    },
    nodes: [
      { id: "agent:writer", type: "agent", layer: "agents", label: "Writer", weight: 0.6, tier: 1, parent: "core", icon: "✍", data: { role: "drafts content" } },
      { id: "agent:researcher", type: "agent", layer: "agents", label: "Researcher", weight: 0.6, tier: 1, parent: "core", icon: "🔎", data: { role: "gathers sources" } },
      { id: "kb:spec", type: "entity", layer: "knowledge", label: "Spec", weight: 0.4, tier: 2, parent: "core" },
      { id: "kb:brand", type: "entity", layer: "knowledge", label: "Brand", weight: 0.4, tier: 2, parent: "core" },
      { id: "mem:1", type: "memory", layer: "memory", label: "shipped v1", weight: 0.2, tier: 3, parent: "agent:writer", data: { text: "v1 shipped against [[kb:spec]] — the launch note the Writer drafted." } },
      { id: "mem:2", type: "memory", layer: "memory", label: "found source", weight: 0.2, tier: 3, parent: "agent:researcher", data: { text: "primary source located; informs [[kb:brand]]." } },
    ],
    links: [
      { source: "agent:writer", target: "kb:spec", type: "uses" },
      { source: "agent:researcher", target: "kb:brand", type: "uses" },
    ],
  },
  null,
  2,
);

// The ORGANIGRAM seed — a source file (committed, unlike the snapshot). Run
// your agents like a company: the panel edits this, agents boot from it. The
// two agents match the sample brain so `npm run panel` demos coherently.
//
// `seed: true` is the ONBOARDING GATE. A scaffold cannot know whether you are a
// hotel, a law firm or one person with a side project, so shipping the same
// writer/researcher pair to everyone and calling it an organigram would be
// fabrication. These two are an honest SAMPLE that makes the panel demo on
// first run; the flag marks them as not-yours-yet. ONBOARDING.md is the ritual
// that replaces them with your real structure, and clearing this flag is the
// last step of it. The CLI can't do that job — it has never seen your system.
// The agent already sitting in this folder has.
const orgJson = JSON.stringify(
  {
    booboo_org: "1.0",
    title: TITLE,
    root: "core",
    seed: true,
    agents: [
      { id: "core", name: TITLE, emoji: "🏛️", role: "the orchestrator — routes, never executes", rules: ["rules/GLOBAL.md"], buckets: ["shared"], boot: "You are the orchestrator. Boot with booboo_boot('core'); route work to your branches, never do it yourself." },
      { id: "writer", name: "Writer", emoji: "📝", role: "drafts content", parent: "core", skills: ["humanizer"], buckets: ["content"] },
      { id: "researcher", name: "Researcher", emoji: "🔎", role: "gathers sources", parent: "core", skills: ["deep-research"], buckets: ["research"] },
    ],
  },
  null,
  2,
);

const pkgJson = JSON.stringify(
  {
    name,
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      build: "booboo build",
      serve: "booboo serve --snapshot brain.json --port 8787",
      mcp: "booboo mcp --snapshot brain.json --org org.booboo.json",
      view: "booboo view --snapshot brain.json",
      panel: "booboo panel --org org.booboo.json --snapshot brain.json",
      vault: "booboo vault --snapshot brain.json --org org.booboo.json --out vault",
    },
    dependencies: {
      "@booboo-brain/cli": BOOBOO_VERSION,
    },
  },
  null,
  2,
);

const readme = `# ${name} — a Booboo brain

A rooted, queryable graph of your system, built with [Booboo](https://github.com/jessymariau/booboo) (the unified operational brain).

## First: shape it to your system

The scaffold ships a **sample** organigram (a Writer and a Researcher) so the panel
demos immediately. It is not yours, and \`org.booboo.json\` is flagged \`"seed": true\`
to say so.

Open this folder in Claude Code / Cursor and say **"set up my brain"**. Your agent
reads [ONBOARDING.md](./ONBOARDING.md), looks at your actual project, asks only what
it cannot infer, proposes a structure for you to correct, and writes the real
organigram. Everything downstream — rules, memory buckets, who reports to whom —
inherits from that one file.

## Quickstart

\`\`\`bash
npm install
npm run build      # booboo.config.yaml → brain.json (the snapshot)
npm run serve      # REST API at http://localhost:8787  (/graph /stats /search /nodes/:id /neighbors/:id /path/:a/:b)
npm run mcp        # MCP over stdio — point Claude / Cursor / Claude Code at it
npm run view       # see your brain in 3D (opens your browser)
npm run panel      # THE ORGANIGRAM — run your agents like a company
\`\`\`

## The organigram — run your agents like a company

\`npm run panel\` opens **org.booboo.json** as a real company chart: drag an agent
under a new parent, hit apply, and the file changes — versioned in git, validated
before every write. Agents that boot with \`booboo_boot('<id>')\` obey the new shape
next session. Rules inherit top-down; each agent carries its buckets, skills and
latest reports. This file is a **source** (commit it) — the snapshot is derived.

## Make it yours

1. Edit **booboo.config.yaml** — declare your \`layers\`, then add \`sources\`.
2. Start from the JSON file (**data.booboo.json**), or uncomment the **postgres** source
   to build straight from your own database. Set \`DATABASE_URL\` in your environment.
3. \`npm run build\` again. The snapshot \`brain.json\` is what gets served.

> **Privacy:** anything whose \`cluster\` is in \`walls:\` is filtered *before* emit — sealed data never reaches the snapshot, API, or MCP.

## The vault — your brain as plain markdown

\`npm run vault\` emits the whole brain as a wiki-linked markdown vault (\`vault/\`):
one page per node, index pages per layer/cluster, an agent dossier per org member.
Open it as an Obsidian vault, read it on a couch, or hand it to ANY agent — plain
files survive every provider. It is derived: regenerate, never hand-edit.

## The agent contract

**AGENTS.md** (imported by CLAUDE.md) is the operating doctrine an AI agent working
this folder reads first: boot from the org, author \`[[wikilinks]]\`, one atomic fact
per note, corrections replace, respect the walls, watch the quality gate. Edit it as
your conventions evolve — it IS your system's constitution.

## MCP

\`npm run mcp\` exposes \`booboo_stats · booboo_search · booboo_node · booboo_neighbors · booboo_path\`
(+ \`booboo_boot · booboo_org\` with \`--org\`) so an AI client can query the brain, plus the LIVE
memory verbs \`booboo_remember\` and \`booboo_report\` — durable writes that append to the journal
beside the snapshot and are queryable the same session (pass \`--no-write\` for a read-only server).
See the Booboo repo for client config.
`;

const gitignore = `node_modules/
# the built snapshot can contain real/private data — don't commit it
brain.json
# the LIVE MEMORY journal — durable agent writes (remember/report). Private,
# and NOT regenerated by build, so it's never deleted — just don't commit it.
*.journal.jsonl
# the vault is derived from the snapshot — regenerate, never commit
vault/
*.log
`;

// The AGENT CONTRACT — the operating doctrine any AI agent working this folder
// reads first (Claude Code reads CLAUDE.md, Codex reads AGENTS.md; CLAUDE.md
// imports this so there is ONE source). A fresh install must leave the user's
// agent knowing exactly how to behave — conventions matching the setup.
const agentsMd = `# ${TITLE} — the agent contract
*Any AI agent working in this folder reads this first, every session. It is the
operating doctrine for this brain — the conventions match the setup.*

## 0. Is this brain set up yet? (check first, every session)
If \`org.booboo.json\` still contains \`"seed": true\`, this brain has NOT been shaped
for this system — it is holding the scaffold's sample Writer/Researcher pair, which
belongs to nobody. **Stop and run \`ONBOARDING.md\` before any other work.** It takes
one pass: read the project, confirm the structure with the human, write the real org.

Until that is done, do not add agents, write memories against the sample agents, or
build anything on top of the placeholder shape — everything downstream inherits from
the org, so work done against a fake structure has to be redone against the real one.

## What this folder is
- \`booboo.config.yaml\` — build config (layers · sources · walls · wikilinks). Edit to shape the brain.
- \`org.booboo.json\` — **SOURCE**: the agent organigram you boot from. Versioned, validated, edited via the panel or a reviewed change — never ad-hoc.
- \`brain.json\` — **DERIVED** snapshot. Regenerate with \`npm run build\`; never hand-edit.
- \`vault/\` — **DERIVED** markdown mirror of the brain (Obsidian-compatible). Regenerate with \`npm run vault\`; never hand-edit.

## The loop (every non-trivial task)
1. **ORIENT** — never assume what the brain knows: boot as your agent (\`booboo_boot('<agent-id>')\` over MCP) for your identity, inherited rules and buckets; then \`booboo_search\`/\`booboo_neighbors\` for the facts you need. *Assumption is not recall.*
2. **ACT** — the smallest correct change.
3. **VERIFY against reality** — \`npm run build\` and read the \`quality\` line; open \`npm run view\` or \`npm run panel\` when the change is visual. Introspection is not verification.
4. **RECORD** — write what you learned: call \`booboo_remember\` (a durable memory) and \`booboo_report\` (what you closed) over MCP. These are LIVE — they append to the journal beside the snapshot and are queryable the same session; no rebuild needed. Close every substantial task with a \`booboo_report\`.

## Writing memories (the conventions that keep the brain curated)
- **Use \`booboo_remember\`** — pass \`agent\` (who it belongs to), \`text\` (the fact), and optionally \`kind\` / \`bucket\`. It writes to the durable journal (survives every rebuild) and is instantly searchable. \`booboo_report\` files what you closed; it lands on the panel's Reports timeline.
- **One atomic fact per note**, written for the future reader. Never dump a transcript — the quality gate counts \`dump-suspects\` and they are a smell.
- **Author your links**: put \`[[node-id]]\` (or \`[[exact label]]\`) refs in the note text where you KNOW the connection. \`wikilinks: true\` turns them into first-class \`authored\` edges that outrank any harvested relation.
- **Corrections replace**: when a note corrects an earlier fact, remove or supersede the old one in the same act. A brain that only accumulates is not curated — stale truth next to live truth is worse than either.
- **Respect the walls**: anything in a \`walls:\` cluster never leaves the builder. Never move data out of a walled cluster; never widen the walls without the human.

## The org is law
Rules in \`org.booboo.json\` inherit top-down — \`booboo_boot\` returns yours; obey them. Reorganising the fleet (reparenting, new agents, rule changes) goes through the panel (\`npm run panel\`) or a reviewed edit so the change is validated and diffable.

## Quality gate (read it every build)
\`npm run build\` prints \`quality · authored:N · orphans:N · dump-suspects:N\`.
Authored should grow; orphans and dumps should not. Rising orphans/dumps = accumulating, not curating — fix the notes before adding more.

## Honest close
End substantial work by reporting plainly: what changed, what you verified against the running thing, what you couldn't verify, and any note you superseded.
`;

const claudeMd = `@AGENTS.md
`;

// THE ONBOARDING RITUAL — how a generic scaffold becomes THIS user's brain.
// Run once, by the agent already working in this folder. Deliberately a
// document and not a CLI wizard: a wizard would have to ask everything,
// because it can't read anything. An agent can read the repo first and only
// ask what the repo cannot tell it.
const onboardingMd = `# Set up this brain — run once, then delete this file

*You are the orchestrator. This folder is a Booboo brain that has NOT been
shaped yet: \`org.booboo.json\` still carries \`"seed": true\` and holds a sample
Writer/Researcher pair that has nothing to do with this system. Your job is to
replace that sample with the real structure, then clear the flag.*

**Do not fabricate a structure.** Everything below is about finding out what is
actually here before you write anything down.

## 1. Read before you ask

Most of an organigram is already sitting in the project. Look, in this order:

- \`package.json\` / \`pyproject.toml\` / \`go.mod\` — what this thing is and is built from
- \`README\` and any architecture doc — what it claims to do, for whom, **and how its
  parts relate**. This is the important one, see the warning below.
- the top two levels of directories — the candidate divisions
- an existing \`CLAUDE.md\` / \`AGENTS.md\` / \`.cursorrules\` — conventions already agreed
- \`git log --oneline -40\` and \`git shortlog -sn\` — what actually gets worked on, and by how many people
- any \`docs/\`, \`ops/\`, \`infra/\` — the surfaces that need an owner

**Folders give you the nouns, not the shape.** A directory listing is flat by
construction, and an org built straight from one is a root with fifteen children
and no structure — which is a list, not an organigram. The grouping almost always
lives in the prose: "X is the contract at the centre, Y and Z feed it, A and B
render it" is three divisions, and no amount of staring at the folder names will
tell you that. Read for how the parts RELATE, then group the nouns under it.

Write down what you inferred. You will show it to the human in step 3 as
statements to correct, which is far easier to answer than an open question.

## 2. Ask only what the repo cannot tell you

Four questions, maximum. Fewer if you already know the answer. Ask them in one
message, not one at a time:

1. **What does this system DO, in one sentence?** (The root agent's purpose.)
2. **What are its real divisions?** Not the folders, the *responsibilities* —
   the things that would each have an owner if this were a company.
3. **What must never be shared between them?** Secrets, client data, anything
   personal. These become \`walls:\` and are filtered before anything is emitted.
4. **What should agents here remember between sessions?** Decisions, incidents,
   customer facts, research? These become the memory buckets.

If the human says "you decide" — decide, from step 1, and say what you decided
and why. Do not stall.

## 3. Propose the shape BEFORE writing it

Print the organigram as a tree, in the message, with one line per agent saying
what it owns and what it can reach. Something like:

\`\`\`
core                    the orchestrator — routes, never executes
├─ <division>           <what it owns>          reaches: <buckets>
│   └─ <role>           <what it does>
└─ <division>           <what it owns>          reaches: <buckets>
\`\`\`

Then ask one question: **"Does this match how it actually works?"** Structure is
cheap to fix now and expensive to fix once agents boot from it.

Rules of thumb worth holding:
- **The root routes, it does not execute.** If the root is doing the work, the
  org is one layer short.
- **A division with one child is not a division** — collapse it.
- **Buckets follow responsibility, not convenience.** If two agents need the
  same bucket, that is a signal they are one agent, or that a parent should own it.
- **Rules inherit downward.** Put a rule as high as it is true, and only there.
  A rule restated on a child is a rule that will drift.

## 4. Write it

- \`org.booboo.json\` — the agents, their parents, roles, \`buckets\`, \`rules\`, a
  \`boot\` line for the root, and a \`cadence\` on every division (see below).
  **Remove \`"seed": true\`** — that is the whole point of this step, and the gate
  in AGENTS.md reads it.

  **Set \`cadence\` on every division: expected HOURS between reports.** Daily is
  24, weekly 168, monthly 720. This is what the health lamp judges — silence past
  about twice the cadence turns a card amber. Leaving it off does not mean "no
  opinion"; consumers fall back to roughly a day, which is a machine's rhythm, so
  a division that genuinely reports weekly will sit amber permanently and the
  board stops meaning anything. Ask the human what each division's real beat is;
  it is usually the answer to "how often would you expect to hear from them?"
- \`booboo.config.yaml\` — set \`layers\` to the planes this system actually has, and
  \`walls\` to the answer from question 3.
- \`data.booboo.json\` — replace the sample nodes, or point \`sources\` at the real
  database and delete it.
- \`rules/\` — create the rule files any agent references. A \`rules:\` entry pointing
  at a file that does not exist is a rule nobody can read.

## 5. Verify against the running thing

\`\`\`bash
npm run build     # must print ok — read the quality line
npm run panel     # the organigram, as the human will see it
\`\`\`

Check with your own eyes: every agent has a parent, the tree matches what was
agreed in step 3, and no rule points at a missing file. \`npm run build\` failing
or the panel showing an agent you did not intend means step 4 is not finished.

## 6. Close

Delete this file — it has done its job, and a completed ritual left lying around
reads as an outstanding one. Then \`booboo_report\` what you set up, and
\`booboo_remember\` the *reasoning* behind the divisions: the next agent inherits
the shape from the org, but it inherits the WHY only from you.
`;

const files: Record<string, string> = {
  "booboo.config.yaml": configYaml,
  "data.booboo.json": dataJson,
  "org.booboo.json": orgJson,
  "package.json": pkgJson,
  "README.md": readme,
  ".gitignore": gitignore,
  "AGENTS.md": agentsMd,
  "CLAUDE.md": claudeMd,
  "ONBOARDING.md": onboardingMd,
};
for (const [f, content] of Object.entries(files)) writeFileSync(path.join(dir, f), content, "utf8");

console.log(`\n🐾 Booboo brain scaffolded → ${dirArg}/\n`);
console.log("Next steps:");
console.log(`  cd ${dirArg}`);
console.log("  npm install");
console.log("  npm run build      # build the graph snapshot");
console.log("  npm run serve      # REST API on http://localhost:8787");
console.log("  npm run mcp        # MCP over stdio (Claude / Cursor / Claude Code)");
console.log("  npm run view       # see your brain in 3D (opens your browser)");
console.log("  npm run panel      # the organigram — run your agents like a company");
console.log("  npm run vault      # the brain as a wiki-linked markdown vault (Obsidian-ready)\n");
console.log("──────────────────────────────────────────────────────────────────────");
console.log("This scaffold does NOT know your system yet. The two agents in");
console.log("org.booboo.json are a SAMPLE so the panel demos on first run.\n");
console.log("  Open this folder in Claude Code / Cursor and say:");
console.log("      set up my brain\n");
console.log("Your agent reads ONBOARDING.md, looks at your actual project, asks");
console.log("what it can't infer, and writes the real organigram. Everything else");
console.log("— rules, buckets, who reports to whom — flows down from that file.");
console.log("──────────────────────────────────────────────────────────────────────\n");
console.log("Your agent's contract is AGENTS.md (CLAUDE.md imports it) — Claude/Codex read it");
console.log("automatically in this folder and will follow the brain's conventions.\n");
console.log("Then edit booboo.config.yaml to point at your own data — a postgres example is included.\n");
console.log("If the scaffold saves you an evening, a star helps the next builder find it → https://github.com/jessymariau/booboo\n");
