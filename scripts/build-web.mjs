/* Assembles the public site: the landing at /, the real viewer app at /viewer/,
   and the hosted ASK endpoint (/api/mcp — a read-only Streamable-HTTP MCP function).
   Run after `pnpm -F @booboo-brain/viewer build`, which produces dist-app/.
   The viewer's vite config uses base:"./" so it works from a subpath untouched.
   web/dist is the DEPLOY ROOT (`vercel deploy web/dist`), so the function's
   package.json + vercel.json must live in web/dist, not the repo root. */

import { cp, rm, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "web", "dist");
const viewerApp = path.join(root, "packages", "viewer", "dist-app");
const panelApp = path.join(root, "packages", "panel", "dist-app");

// tokens first: the site's CSS vars and the viewer's constants are generated,
// so a stale build can never ship a hand-drifted palette.
await import("./gen-tokens.mjs");

if (!existsSync(viewerApp)) {
  console.error(`✗ ${viewerApp} missing — run: pnpm -F @booboo-brain/viewer build`);
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const f of ["index.html", "styles.css", "main.js", "tokens.css"]) {
  await cp(path.join(root, "web", f), path.join(out, f));
}
// page imagery: the product photographing itself. A brand landing with no
// imagery reads as incomplete rather than restrained.
await cp(path.join(root, "web", "img"), path.join(out, "img"), { recursive: true });
await cp(viewerApp, path.join(out, "viewer"), { recursive: true });
// the Pemberton demo brain — the default thing the site shows
await cp(path.join(root, "examples", "pemberton", "pemberton.booboo.json"), path.join(out, "pemberton.booboo.json"));
// the GOVERN face: the panel app at /chart/ (its /api/* calls are rewritten to panelapi)
if (existsSync(panelApp)) {
  await cp(panelApp, path.join(out, "chart"), { recursive: true });
} else {
  console.error("✗ panel dist-app missing — run: pnpm -F @booboo-brain/panel build (skipping /chart/)");
}

// ── the hosted ASK endpoint: /api/mcp (Vercel builds functions from api/ at the deploy root)
await cp(path.join(root, "web", "api"), path.join(out, "api"), { recursive: true });
await mkdir(path.join(out, "api", "_data"), { recursive: true });
for (const f of ["pemberton.booboo.json", "org.pemberton.booboo.json"]) {
  await cp(path.join(root, "examples", "pemberton", f), path.join(out, "api", "_data", f));
}
// deps for the function only — no "build" script, so Vercel skips the build step
// and just installs, serves the static files, and traces api/ into functions.
await writeFile(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: "booboo-demo-site",
      private: true,
      type: "module",
      engines: { node: "22.x" },
      dependencies: { "@modelcontextprotocol/sdk": "1.29.0", zod: "3.25.76" },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(out, "vercel.json"),
  JSON.stringify(
    {
      // This deploy root carries a package.json (deps for the function) but NO
      // lockfile — it is generated, not a workspace. Vercel's default
      // `pnpm install --frozen-lockfile` therefore fails the build outright
      // ("Command exited with 1") the moment it cannot reuse a previous cache.
      // Pin the install to npm, which is happy to resolve two pinned deps
      // without a lockfile.
      installCommand: "npm install --no-audit --no-fund",
      // web/dist is ALREADY BUILT — that is the whole point of this script. The
      // Vercel project's own build command assumes a repo-root deploy
      // ("pnpm -F @booboo-brain/viewer build && ... && node scripts/build-web.mjs")
      // and there is no monorepo inside the deploy root, so it exits 1. An empty
      // buildCommand overrides the project setting and ships the static tree.
      buildCommand: "",
      functions: {
        "api/mcp.mjs": { maxDuration: 60, includeFiles: "api/_data/**" },
        "api/panelapi.mjs": { maxDuration: 30, includeFiles: "api/_data/**" },
      },
      // The viewer and panel are built with base:"./" so the published packages
      // work from any subpath. That makes the trailing slash load-bearing: at
      // /viewer the browser resolves ./assets against the domain root and 404s,
      // at /viewer/ it resolves correctly. Send the bare paths to the slashed ones.
      redirects: [
        { source: "/viewer", destination: "/viewer/", permanent: false },
        { source: "/chart", destination: "/chart/", permanent: false },
        { source: "/view", destination: "/viewer/", permanent: false },
        // A bare /viewer/ renders main.tsx's 3-node placeholder — correct for the
        // published package (a local user has no snapshot yet), wrong for this
        // site, where it means every shared, typed or bookmarked viewer link
        // shows a toy instead of the 2,839-node house. Fixed here rather than in
        // the package so the placeholder keeps working for everyone else.
        // `missing` guards both entry params: ?file= is an explicit snapshot and
        // ?n= is the synthetic generator, so neither gets clobbered.
        {
          source: "/viewer/",
          destination: "/viewer/?file=/pemberton.booboo.json",
          permanent: false,
          missing: [{ type: "query", key: "file" }, { type: "query", key: "n" }],
        },
      ],
      rewrites: [
        { source: "/mcp", destination: "/api/mcp" },
        // the panel app's same-origin API, funnelled into one read-only function
        { source: "/api/org", destination: "/api/panelapi?r=org" },
        { source: "/api/boot/:id", destination: "/api/panelapi?r=boot&id=:id" },
        { source: "/api/graph", destination: "/api/panelapi?r=graph" },
        { source: "/api/stats", destination: "/api/panelapi?r=stats" },
        { source: "/api/clusters", destination: "/api/panelapi?r=clusters" },
        { source: "/api/search", destination: "/api/panelapi?r=search" },
        { source: "/api/nodes/:id", destination: "/api/panelapi?r=node&id=:id" },
        { source: "/api/nodes", destination: "/api/panelapi?r=nodes" },
        { source: "/api/neighbors/:id", destination: "/api/panelapi?r=neighbors&id=:id" },
        // the panel's embedded Graph tab expects the CLI server's paths
        { source: "/snapshot.json", destination: "/pemberton.booboo.json" },
        { source: "/view/", destination: "/viewer/index.html" },
        { source: "/view/:path+", destination: "/viewer/:path+" },
      ],
    },
    null,
    2,
  ) + "\n",
);

const listed = await readdir(out);
console.log(`✓ web/dist ready → ${listed.join(", ")}`);
