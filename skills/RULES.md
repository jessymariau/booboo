# Booboo operator rules

*The laws for building and deploying brains. Every `booboo-*` skill in this pack
inherits these. Read once per session before you write to anyone's brain.*

These are **operator-side** rules — you, working on or deploying a brain. They are
deliberately distinct from the `AGENTS.md` contract that ships inside a scaffolded
project, which governs an agent *authoring* within its own brain. Where both apply
to the same folder, **the project's `AGENTS.md` wins.** Do not copy rules between
the two files; reference them.

---

## 1. Derived files are never hand-edited

`brain.json` is output. `vault/` is output. Both are regenerated from
`booboo.config.yaml` plus the sources, and any edit you make to them is erased by
the next build without warning.

`org.booboo.json` is the exception and the opposite: it is **source**. It is
versioned, validated before every write, and changed through the panel or a
reviewed edit. Never write it ad hoc from a script.

If you catch yourself editing a snapshot to make a demo look right, stop. Fix the
config or the source data — a snapshot doctored by hand is a lie the next build
deletes.

## 2. The walls are absolute

Anything in a `walls:` cluster is filtered **in the builder**, before the JSON, the
API, the MCP server and the viewer exist. That ordering is the whole guarantee.

- Never move data out of a walled cluster to make it visible.
- Never widen `walls:` without the human who owns the data saying so, in that session.
- Never work around a wall by adding a second source that reads the same table.

A wall you quietly narrowed is a data leak with a commit attached.

## 3. Ship the shortest adapter, never a fork

Weird data gets a small config-driven adapter — on the order of fifty lines against
the spec. It does not get a forked builder, a patched package, or a vendored copy
of `@booboo-brain/build`.

The spec is a ~1 KB contract precisely so the escape hatch stays cheap. If a job
seems to need a fork, you have almost certainly misread the spec — go back to
`SPEC.md` before writing code.

## 4. Verify against the running thing

A build that printed no error is not a build that worked.

- After `booboo build`, read the **quality line**: `quality · authored:N ·
  orphans:N · dump-suspects:N`. Rising orphans or dumps mean the brain is
  accumulating rather than being curated. That is a defect, not a statistic.
- After any change that shows up visually, open `booboo view` or `booboo panel`
  and look at it.
- After wiring MCP, actually call `booboo_boot` and read what comes back. A server
  that starts is not a server that answers.

Introspection is not verification. "I believe the config is right" returns yes
every time and means nothing.

## 5. One atomic fact per memory

`booboo_remember` takes one fact, written for the reader who arrives a month later
with no context. Never a transcript, never a session dump — the quality gate counts
`dump-suspects` and they are a smell that compounds.

Author the links you actually know: `[[node-id]]` or `[[exact label]]` inside the
note text, with `wikilinks: true` in the config, become first-class `authored`
edges that outrank anything harvested. A link you guessed at is worse than no link,
because it outranks the harvested one that was right.

**Corrections replace.** When a note corrects an earlier fact, supersede or remove
the old one in the same act. Stale truth sitting next to live truth is worse than
either alone, and a brain that only accumulates is not curated.

## 6. Boot from the org, then act

`booboo_boot('<agent-id>')` returns identity, authority chain, inherited rules,
bucket reach and children. Call it first, every session, before deciding anything.

Rules in the org inherit top-down: declared once at a branch, binding on everything
beneath. You do not get to opt out of an inherited rule because it is inconvenient
for the current task — you change it at the branch, through the panel, where the
change is validated and diffable.

## 7. Never fabricate structure

When shaping an org, read the project first: `package.json`, the README and any
architecture doc, the top two directory levels, an existing `CLAUDE.md` or
`.cursorrules`, `git log` and `git shortlog -sn`.

**Folders give you the nouns, not the shape.** A directory listing is flat by
construction, and an org built straight from one is a root with fifteen children —
a list, not an organigram. The grouping lives in the prose: "X is the contract at
the centre, Y and Z feed it, A and B render it" is three divisions, and no amount
of staring at folder names will reveal it.

If the structure genuinely is not discoverable, ask. A confidently invented
hierarchy is the single most expensive mistake in this system, because everything
downstream inherits from it.

## 8. Close honestly

End substantial work by reporting: what changed, what you verified against the
running thing, what you could **not** verify, and any note you superseded.

`booboo_report` is the durable half of that — it lands on the panel's Reports
timeline where the next operator reads it. A silent close means the next person
starts from zero.

---

## What this pack must never claim

- **Not a memory store.** Booboo has memory; it is not competing on memory. Pitch
  the org-chart layer.
- **No feature is behind a paywall.** The repo is MIT and stays MIT. The paid
  tiers at fractionalhq.uk buy setup time, not capability. Saying otherwise is
  both false and bad for the project.
- **Alpha means alpha.** Per-package semver, eight published packages, real edges
  still being filed. Do not describe it as battle-tested. The 4,469-node
  production brain and the million-node synthetic render are the honest proof
  points — cite those, not adjectives.
