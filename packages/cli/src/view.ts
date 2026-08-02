// `booboo view` — serve the prebuilt 3D viewer app + a snapshot, locally.
// The end user sees their brain in 3D without cloning the monorepo. Pure stdlib:
// the heavy React/three is already bundled into @booboo-brain/viewer's static app, so
// this server just hands out files — it never loads the viewer's runtime deps.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

/** Locate @booboo-brain/viewer's shipped static app (dist-app). */
function appDir(): string {
  const require = createRequire(import.meta.url);
  let pkgJson: string;
  try {
    pkgJson = require.resolve("@booboo-brain/viewer/package.json");
  } catch {
    throw new Error("@booboo-brain/viewer is not installed — run `npm i @booboo-brain/viewer`.");
  }
  const dir = join(pkgJson, "..", "dist-app");
  if (!existsSync(join(dir, "index.html"))) {
    throw new Error("the viewer app isn't built — reinstall @booboo-brain/viewer (or `pnpm --filter @booboo-brain/viewer build` in the repo).");
  }
  return dir;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening is best-effort; the URL is printed regardless */
  }
}

export interface ViewOpts {
  snapshot?: string;
  demo?: boolean;
  nodes?: number;
  port: number;
  open: boolean;
}

export async function view(opts: ViewOpts): Promise<void> {
  if (!opts.snapshot && !opts.demo) {
    console.error("usage: booboo view --snapshot graph.json [--port 8989] [--no-open]\n       booboo view --demo [--nodes 100000]");
    process.exit(1);
  }

  const dir = appDir();
  const dirPrefix = dir.endsWith(sep) ? dir : dir + sep;

  let snapshot: Buffer | null = null;
  if (opts.snapshot) {
    if (!existsSync(opts.snapshot)) {
      console.error(`booboo view: snapshot not found — ${opts.snapshot}`);
      process.exit(1);
    }
    snapshot = await readFile(opts.snapshot);
  }

  const server = createServer(async (req, res) => {
    const reqPath = decodeURIComponent((req.url ?? "/").split("?")[0]);

    // Bare `/` without a query would render the app's tiny fallback sample —
    // send the visitor to what this server is actually hosting.
    if (reqPath === "/" && !(req.url ?? "").includes("?")) {
      res.writeHead(302, { location: opts.snapshot ? "/?file=/snapshot.json" : `/?n=${opts.nodes ?? 100000}` });
      res.end();
      return;
    }

    if (reqPath === "/snapshot.json") {
      if (!snapshot) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(snapshot);
      return;
    }

    // Static files from the app dir, with a path-traversal guard (trust boundary).
    let file = normalize(join(dir, reqPath === "/" ? "index.html" : reqPath));
    if (file !== dir && !file.startsWith(dirPrefix)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (!existsSync(file)) file = join(dir, "index.html"); // SPA fallback
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.error(`booboo view: port ${opts.port} is in use — pass --port <n>.`);
    else console.error("booboo view:", e.message);
    process.exit(1);
  });

  server.listen(opts.port, () => {
    const query = opts.snapshot ? "?file=/snapshot.json" : `?n=${opts.nodes ?? 100000}`;
    const url = `http://localhost:${opts.port}/${query}`;
    console.error(`🐾 booboo view · serving on http://localhost:${opts.port}`);
    console.error(`   → ${url}`);
    // Demo mode only — the first-touch moment. A star ask on every daily `view` run would be nagging.
    if (opts.demo) console.error("   liked the render? a star helps the next person find it → https://github.com/jessymariau/booboo");
    if (opts.open) openBrowser(url);
  });
}
