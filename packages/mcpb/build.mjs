#!/usr/bin/env node
// Build the Booboo MCPB bundle for Smithery / Claude Desktop.
//
//   node packages/mcpb/build.mjs            # bundle the published @booboo-brain/serve
//   node packages/mcpb/build.mjs 0.5.0      # pin a specific serve version
//
// Output: packages/mcpb/build/booboo.mcpb
//
// WHY IT INSTALLS FROM NPM RATHER THAN THE WORKSPACE: pnpm workspaces link
// packages by symlink, and a symlinked node_modules does not survive being
// zipped into a bundle. Installing the published tarball into a clean staging
// directory gives a flat, real, self-contained tree — which is what an MCPB is.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildDir = join(here, "build");
const stageDir = join(buildDir, "stage");
const serverDir = join(stageDir, "server");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

// The bundle version tracks the CLI, because that is the version users see on
// npm and in the MCP registry. Keeping a separate number would just be one more
// thing to drift.
const cliPkg = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"));
const version = cliPkg.version;
const serveSpec = process.argv[2] ? `@booboo-brain/serve@${process.argv[2]}` : "@booboo-brain/serve";

console.log(`🐾 building booboo.mcpb  version=${version}  serve=${serveSpec}`);

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

// 1 — the entry point
cpSync(join(here, "src", "index.mjs"), join(serverDir, "index.mjs"));

// 2 — a real, flat dependency tree (serve only; the CLI's build/viewer/panel/
//     vault paths are never reached by the MCP entry point)
writeFileSync(
  join(serverDir, "package.json"),
  JSON.stringify({ name: "booboo-mcpb-server", private: true, type: "module", version }, null, 2),
);
run(npm, ["install", serveSpec, "--omit=dev", "--no-audit", "--no-fund"], serverDir);

// 3 — the manifest, with the version injected
const manifest = readFileSync(join(here, "manifest.template.json"), "utf8").replaceAll("__VERSION__", version);
writeFileSync(join(stageDir, "manifest.json"), manifest);
JSON.parse(manifest); // fail loudly here rather than inside mcpb pack

// 3b — the icon. The manifest names it, so a missing file is a broken listing.
const iconSrc = join(here, "icon.png");
if (!existsSync(iconSrc)) {
  console.error("booboo: icon.png missing — the manifest declares it and directories render it");
  process.exit(1);
}
cpSync(iconSrc, join(stageDir, "icon.png"));

// 4 — pack
run(npx, ["-y", "@anthropic-ai/mcpb@2", "pack", stageDir, join(buildDir, "booboo.mcpb")], repoRoot);

const out = join(buildDir, "booboo.mcpb");
if (!existsSync(out)) {
  console.error("booboo: pack reported success but produced no bundle");
  process.exit(1);
}
console.log(`\n🐾 → ${out}`);
console.log("   publish:  npx -y @smithery/cli mcp publish " + JSON.stringify(out) + " -n <namespace>/booboo");
