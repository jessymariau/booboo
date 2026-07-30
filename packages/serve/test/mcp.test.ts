import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runMcp } from "../src/mcp.js";
import { BoobooIndex } from "../src/graph.js";
import { JournalWriter, journalPathFor } from "../src/journal.js";
import type { BoobooGraph, BOrg } from "@booboo-brain/spec";

// The MCP face is what every desktop client and all five directories actually
// reach, and it had no test at all — so an SDK bump could retire `server.tool`
// (already @deprecated in 1.29) and ship a brainless server to every listing.
// These assert the CONTRACT: which tools exist, and what they answer.

const fresh = (): BoobooGraph => ({
  booboo: "1.0",
  meta: { root: "core", layers: [{ name: "agents" }, { name: "memory" }] },
  nodes: [
    { id: "core", type: "root", layer: "agents", label: "Core", weight: 1 },
    { id: "agent:engineering", type: "agent", layer: "agents", label: "Engineering", weight: 0.6 },
  ],
  links: [{ source: "core", target: "agent:engineering", type: "spine" }],
});

const org: BOrg = {
  booboo_org: "1.0",
  root: "gm",
  agents: [
    { id: "gm", name: "General Manager", rules: ["house-standard"], buckets: ["house"] },
    { id: "engineering", name: "Engineering", parent: "gm", rules: ["eng-sop"], buckets: ["engineering"] },
  ],
};

type ToolResult = { content: { type: string; text: string }[] };
const payload = (res: unknown) => JSON.parse((res as ToolResult).content[0].text);

let dir: string;
let open: Client[] = [];

async function connect(opts: { org?: BOrg; writer?: JournalWriter; ix?: BoobooIndex } = {}) {
  const ix = opts.ix ?? new BoobooIndex(fresh());
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runMcp(ix, "booboo", opts.org, opts.writer, serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  open.push(client);
  return { client, ix };
}

const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "booboo-mcp-"));
});
afterEach(async () => {
  for (const c of open) await c.close();
  open = [];
  rmSync(dir, { recursive: true, force: true });
});

describe("runMcp tool registration", () => {
  it("registers the read tools against the installed SDK", async () => {
    const { client } = await connect();
    expect(await names(client)).toEqual([
      "booboo_count",
      "booboo_neighbors",
      "booboo_node",
      "booboo_path",
      "booboo_search",
      "booboo_stats",
    ]);
  });

  it("adds the org tools only when an org is loaded", async () => {
    expect(await names((await connect()).client)).not.toContain("booboo_boot");
    expect(await names((await connect({ org })).client)).toEqual(expect.arrayContaining(["booboo_boot", "booboo_org"]));
  });

  it("adds the write tools only when a writer is passed — read-only stays read-only", async () => {
    const writer = new JournalWriter(new BoobooIndex(fresh()), journalPathFor(join(dir, "brain.json")));
    expect(await names((await connect()).client)).not.toContain("booboo_remember");
    const withWriter = await names((await connect({ writer })).client);
    expect(withWriter).toEqual(expect.arrayContaining(["booboo_remember", "booboo_report"]));
  });

  it("describes every tool — a nameless tool is unusable to a model", async () => {
    const { tools } = await (await connect({ org })).client.listTools();
    for (const t of tools) expect(t.description ?? "").not.toHaveLength(0);
  });
});

describe("runMcp tool answers", () => {
  it("booboo_stats counts the real graph", async () => {
    const { client } = await connect();
    const stats = payload(await client.callTool({ name: "booboo_stats", arguments: {} }));
    expect(stats.nodes).toBe(2);
    expect(stats.links).toBe(1);
  });

  it("booboo_search finds a node by label", async () => {
    const { client } = await connect();
    const hits = payload(await client.callTool({ name: "booboo_search", arguments: { query: "Engineering" } }));
    expect(hits[0].id).toBe("agent:engineering");
  });

  it("booboo_boot returns the authority chain with rules inherited ancestors-first", async () => {
    const { client } = await connect({ org });
    const slice = payload(await client.callTool({ name: "booboo_boot", arguments: { agent: "engineering" } }));
    expect(slice.chain.map((a: { id: string }) => a.id)).toEqual(["gm", "engineering"]);
    expect(slice.rules).toEqual(["house-standard", "eng-sop"]); // order is the contract
    expect(slice.buckets).toEqual(expect.arrayContaining(["house", "engineering"]));
  });

  it("booboo_boot answers an unknown agent instead of throwing", async () => {
    const { client } = await connect({ org });
    const res = payload(await client.callTool({ name: "booboo_boot", arguments: { agent: "nobody" } }));
    expect(res.error).toContain("nobody");
    expect(res.agents).toEqual(["gm", "engineering"]); // tells the model what it may call
  });

  it("booboo_remember persists and is queryable in the same session", async () => {
    const ix = new BoobooIndex(fresh());
    const writer = new JournalWriter(ix, journalPathFor(join(dir, "brain.json")));
    const { client } = await connect({ ix, writer });
    const { node } = payload(
      await client.callTool({
        name: "booboo_remember",
        arguments: { agent: "engineering", text: "lift 3 reconditioned", bucket: "engineering" },
      }),
    );
    expect(node.type).toBe("memory");
    expect(ix.node(node.id)?.id).toBe(node.id);
    const hits = payload(await client.callTool({ name: "booboo_search", arguments: { query: "reconditioned" } }));
    expect(hits[0].id).toBe(node.id);
  });
});
