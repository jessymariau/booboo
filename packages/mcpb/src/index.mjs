#!/usr/bin/env node
// Booboo MCPB entry point.
//
// This mirrors `booboo mcp --snapshot <path> [--org <path>] [--no-write]` from
// packages/cli/src/cli.ts, with two deliberate differences:
//
//   1. Configuration arrives as environment variables, not flags. MCPB hosts
//      interpolate ${user_config.*} into mcp_config; an unset optional value
//      interpolates to an empty string rather than dropping the flag, which
//      would hand `--org ""` to the CLI and break the load. Env vars let us
//      test for empty and skip cleanly.
//   2. Only @booboo-brain/serve is bundled. The CLI lazy-loads build/viewer/
//      panel/vault, so an MCP-only bundle never needs them — that is the
//      difference between a 14 MB bundle and a 181 MB one.
//
// MCP speaks JSON-RPC on stdout. Every human-readable line MUST go to stderr.

import {
  loadSnapshot,
  loadOrg,
  BoobooIndex,
  runMcp,
  journalPathFor,
  replayJournal,
  JournalWriter,
} from "@booboo-brain/serve";

const clean = (v) => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : undefined;
};

const snapshot = clean(process.env.BOOBOO_SNAPSHOT);
const orgPath = clean(process.env.BOOBOO_ORG);
const journalOverride = clean(process.env.BOOBOO_JOURNAL);
// MCPB interpolates a boolean user_config as the string "true"/"false"; the CLI
// and the docs use "1". Accept both, and treat anything else as writable.
const readonly = ["1", "true", "yes"].includes((process.env.BOOBOO_READONLY ?? "").trim().toLowerCase());

if (!snapshot) {
  console.error(
    "booboo: no snapshot configured.\n" +
      "Set the 'Booboo snapshot' file in this extension's settings — it is the graph.json\n" +
      "produced by `booboo build` (scaffold one with `npx create-booboo`).",
  );
  process.exit(1);
}

async function main() {
  const ix = new BoobooIndex(loadSnapshot(snapshot));

  // Live memory: replay past writes from the durable journal beside the
  // snapshot, then (unless read-only) hand the MCP server a writer for new ones.
  const journalPath = journalOverride ?? journalPathFor(snapshot);
  const replayed = replayJournal(ix, journalPath);
  if (replayed) {
    console.error(`🐾 journal · replayed ${replayed} live write(s) from ${journalPath}`);
  }
  const writer = readonly ? undefined : new JournalWriter(ix, journalPath);

  console.error(
    `🐾 booboo MCP · ${ix.counts().nodes.toLocaleString()} nodes · ` +
      `${readonly ? "read-only" : "writable"}${orgPath ? " · org loaded" : ""}`,
  );

  await runMcp(ix, "booboo", orgPath ? loadOrg(orgPath) : undefined, writer);
}

main().catch((e) => {
  console.error("booboo:", e?.message ?? e);
  process.exit(1);
});
