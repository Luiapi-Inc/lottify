#!/usr/bin/env node
/**
 * Dev runner for DI-driven NestJS entrypoints (dev:api, dev:worker).
 *
 * WHY THIS EXISTS (W5-F5):
 *   The old scripts used `tsx watch <entry.ts>`. tsx transpiles via esbuild,
 *   which does NOT implement `emitDecoratorMetadata`, so NestJS constructor DI
 *   sees no `design:paramtypes` and every injected dependency resolves to
 *   `undefined` at runtime (health endpoints 500). This runner instead
 *   compiles the backend with `tsc` (which emits decorator metadata, the same
 *   shape production containers execute) and runs the compiled output with
 *   `node --watch`, restarting on rebuild.
 *
 * Usage:  pnpm dev <src-entry-relative-to-repo>
 *   e.g.  pnpm dev apps/api/src/main.ts
 *         pnpm dev apps/workers/src/main.ts
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");

const srcEntry = process.argv[2];
if (!srcEntry || !srcEntry.endsWith(".ts")) {
  console.error("usage: pnpm dev <src-entry>   e.g. pnpm dev apps/api/src/main.ts");
  process.exit(1);
}

const distEntry = path.join(repo, "dist", srcEntry.replace(/\.ts$/, ".js"));
const tscBin = path.join(repo, "node_modules", ".bin", "tsc");

function spawnChild(cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit", cwd: repo });
  child.on("error", (err) => {
    console.error(`failed to spawn ${cmd}:`, err.message);
    process.exit(1);
  });
  return child;
}

// 1. Initial full build with decorator metadata (blocks until tsc exits).
console.log(`[dev] compiling (emitDecoratorMetadata) -> dist/${path.relative(repo, distEntry)}`);
const initialBuild = spawnChild(tscBin, ["-p", "tsconfig.backend.json"]);
initialBuild.on("exit", (code) => {
  if (code !== 0) {
    console.error(`[dev] initial compile failed (tsc exit ${code})`);
    process.exit(code ?? 1);
  }
  if (!existsSync(distEntry)) {
    console.error(`[dev] compiled entry not found after build: ${distEntry}`);
    process.exit(1);
  }
  console.log(`[dev] initial compile OK -> running ${path.relative(repo, distEntry)}`);

  // 2. Watch source and rebuild on change.
  const tscWatch = spawnChild(tscBin, ["-p", "tsconfig.backend.json", "--watch"]);

  // 3. Run the compiled entry; node --watch restarts it when tsc rewrites dist.
  const nodeWatch = spawnChild(process.execPath, ["--watch", distEntry]);

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of [nodeWatch, tscWatch]) {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  nodeWatch.on("exit", (childCode) => {
    shutdown("SIGTERM");
    process.exit(childCode ?? 0);
  });
});
