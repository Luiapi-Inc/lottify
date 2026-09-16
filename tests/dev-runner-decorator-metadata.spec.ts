/**
 * W5-F5 guard: NestJS constructor DI must have decorator metadata in the dev
 * runner. `tsx` (esbuild) does not emit `design:paramtypes`, so any DI-driven
 * entrypoint started through `tsx watch` resolves every injected dependency to
 * `undefined` (health endpoints 500). This test fails if the dev scripts
 * regress back to a metadata-less runner.
 *
 * See docs/implementation/dev-runner-decorator-metadata.md for the full record.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");

function readPackageJson(): { scripts: Record<string, string> } {
  const raw = readFileSync(path.join(REPO, "package.json"), "utf8");
  return JSON.parse(raw) as { scripts: Record<string, string> };
}

describe("W5-F5 dev-runner decorator metadata", () => {
  it("dev:api must not run through `tsx` (esbuild emits no decorator metadata)", () => {
    const { scripts } = readPackageJson();
    const devApi = scripts["dev:api"] ?? "";
    expect(devApi, "dev:api script must exist").not.toBe("");
    expect(devApi, "dev:api must not use tsx").not.toContain("tsx");
    expect(devApi, "dev:api must run the metadata-emitting dev runner")
      .toMatch(/node scripts\/dev\.mjs/);
  });

  it("dev:worker must not run through `tsx`", () => {
    const { scripts } = readPackageJson();
    const devWorker = scripts["dev:worker"] ?? "";
    expect(devWorker, "dev:worker script must exist").not.toBe("");
    expect(devWorker, "dev:worker must not use tsx").not.toContain("tsx");
    expect(devWorker, "dev:worker must run the metadata-emitting dev runner")
      .toMatch(/node scripts\/dev\.mjs/);
  });

  it("the dev runner and its tsc compile target both exist", () => {
    expect(existsSync(path.join(REPO, "scripts", "dev.mjs"))).toBe(true);
    expect(existsSync(path.join(REPO, "tsconfig.backend.json"))).toBe(true);
  });

  it("backend tsconfig emits decorator metadata (source of the fix)", () => {
    const raw = readFileSync(path.join(REPO, "tsconfig.backend.json"), "utf8");
    const cfg = JSON.parse(raw) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
    };
    // The base tsconfig.json carries emitDecoratorMetadata:true; the backend
    // build extends it. Verify the effective flag is reachable by resolving
    // the extends chain.
    const baseRaw = readFileSync(path.join(REPO, cfg.extends ?? "tsconfig.json"), "utf8");
    const baseCfg = JSON.parse(baseRaw) as { compilerOptions?: Record<string, unknown> };
    const merged = { ...baseCfg.compilerOptions, ...cfg.compilerOptions };
    expect(merged.emitDecoratorMetadata).toBe(true);
    expect(merged.experimentalDecorators).toBe(true);
  });
});
