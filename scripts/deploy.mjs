#!/usr/bin/env node
// The only sanctioned way to ship booboo.fractionalhq.uk.
//
//   node scripts/deploy.mjs            # guard → build → deploy → verify
//   node scripts/deploy.mjs --dry-run  # guard + build only, ship nothing
//
// WHY THIS EXISTS. The Vercel project has NO git connection: pushing to main
// deploys nothing, and production only ever changes when a human runs the CLI.
// That makes an accidental regression from a push impossible and makes silent
// drift between the repo and the live site entirely possible, because nothing
// reconciles them. This is the thing that reconciles them.
//
// It refuses to ship a tree that is not exactly what is on origin/main, then
// proves the result afterwards rather than trusting READY. Vercel reports READY
// for a deployment whose routes are broken, and the whole history of this page
// is static checks passing while the page was wrong.
//
// The escape hatch is deliberate and loud: --force skips the git guard, prints
// what it is overriding, and the commit stamp in version.json still records the
// dirty tree, so an emergency hand-deploy is possible but never invisible.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const DOMAIN = "https://booboo.fractionalhq.uk";

// sh() CAPTURES, run() STREAMS. Keeping them apart is not tidiness: execSync
// returns null when stdout is inherited, so a shared helper that ends in
// .trim() throws on every streamed command and the catch around it reports a
// build failure that never happened. That cost a deploy cycle here.
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: ["ignore", "inherit", "inherit"], ...opts });
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

// ── 1. the git guard ────────────────────────────────────────────────────────
console.log("· checking the tree matches origin/main");
try { sh("git fetch origin main"); } catch { console.warn("  ! could not fetch origin — comparing against the last known ref"); }

const head = sh("git rev-parse HEAD");
const remote = sh("git rev-parse origin/main");
const branch = sh("git rev-parse --abbrev-ref HEAD");
const dirty = sh("git status --porcelain");

const problems = [];
if (branch !== "main") problems.push(`on branch "${branch}", not main`);
if (head !== remote) problems.push(`HEAD ${head.slice(0, 7)} != origin/main ${remote.slice(0, 7)} — commit and push first`);
if (dirty) problems.push(`working tree is not clean:\n    ${dirty.split("\n").join("\n    ")}`);

if (problems.length) {
  if (!FORCE) die(`refusing to deploy.\n  ${problems.join("\n  ")}\n\n  Fix those, or re-run with --force to ship anyway (version.json will record it).`);
  console.warn(`  ! --force: shipping despite\n    ${problems.join("\n    ")}`);
}
console.log(`  ✓ ${head.slice(0, 7)} clean and level with origin/main`);

// ── 2. the real build ───────────────────────────────────────────────────────
// The exact commands Vercel's buildCommand would run, in order. build-web.mjs
// refuses if a package's source is newer than its bundle, so a stale viewer
// cannot slip through.
console.log("· building");
for (const cmd of [
  "pnpm -F @booboo-brain/viewer build",
  "pnpm -F @booboo-brain/panel build",
  "node scripts/build-web.mjs",
]) {
  try { run(cmd); }
  catch { die(`build step failed: ${cmd}`); }
}

const stamp = JSON.parse(readFileSync(path.join(root, "web", "dist", "version.json"), "utf8"));
if (!FORCE && stamp.commit !== head) die(`version.json says ${stamp.commit} but HEAD is ${head}`);

if (DRY) { console.log(`\n✓ dry run: built ${head.slice(0, 7)}, shipped nothing\n`); process.exit(0); }

// ── 3. ship ─────────────────────────────────────────────────────────────────
// web/dist is the deploy root and --archive=tgz is required; deploying the repo
// root instead 404s every API route while /chart/ still 200s, which is exactly
// the kind of half-working deploy that reads as success.
console.log("· deploying");
let url;
try {
  const out = sh("vercel deploy --prod --archive=tgz --yes", { cwd: path.join(root, "web", "dist") });
  url = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("https://")).pop();
  console.log(`  ✓ ${url}`);
} catch (e) { die(`vercel deploy failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`); }

// ── 4. prove it, on the real domain ─────────────────────────────────────────
// READY is not correct. Assert the routes AND that the live commit is the one
// just built, which is the check that would have caught a wrong-project deploy.
console.log("· verifying " + DOMAIN);
await new Promise((r) => setTimeout(r, 8000));

const expect = { "/": 200, "/mcp": 405, "/chart/": 200, "/viewer/": 307, "/api/org": 200, "/version.json": 200 };
const fail = [];
for (const [route, want] of Object.entries(expect)) {
  let got = 0;
  try { got = Number(sh(`curl -s -o /dev/null -w "%{http_code}" ${DOMAIN}${route}`)); } catch { /* got stays 0 */ }
  console.log(`  ${got === want ? "✓" : "✗"} ${route.padEnd(14)} ${got} (want ${want})`);
  if (got !== want) fail.push(`${route} returned ${got}, wanted ${want}`);
}

try {
  const live = JSON.parse(sh(`curl -s ${DOMAIN}/version.json`));
  const ok = live.commit === head;
  console.log(`  ${ok ? "✓" : "✗"} live commit ${live.commit?.slice(0, 7)} ${ok ? "matches" : "DOES NOT MATCH"} ${head.slice(0, 7)}`);
  if (!ok) fail.push(`live commit ${live.commit} != deployed ${head}`);
} catch { fail.push("could not read /version.json from the live domain"); }

if (fail.length) {
  console.error(`\n✗ deployed but FAILED verification:\n  ${fail.join("\n  ")}`);
  console.error(`\n  Roll back with:\n    vercel rollback <previous-url> --scope task-next-ai --yes\n  List candidates with: vercel list --scope task-next-ai booboo\n`);
  process.exit(1);
}

// The scroll mechanic is a separate, slower gate; naming it here rather than
// running it keeps deploys quick, and skipping it silently is how the tunnel
// shipped broken twice.
console.log(`\n✓ ${head.slice(0, 7)} live and verified at ${DOMAIN}`);
console.log(`  Behaviour is NOT covered by the checks above. For any change to the`);
console.log(`  tunnel, run: node scripts/check-descent.mjs --base ${DOMAIN}\n`);
