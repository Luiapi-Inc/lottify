import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTEXT_MANIFEST } from "../../src/contexts/context-manifest";

describe("bounded-context architecture", () => {
  it("locks exactly the thirteen approved bounded contexts", () => {
    expect(CONTEXT_MANIFEST).toHaveLength(13);
    expect(new Set(CONTEXT_MANIFEST.map((context) => context.key)).size).toBe(13);
  });

  it("does not import one bounded context directly from another", async () => {
    const root = resolve(process.cwd(), "src/contexts");
    for (const context of CONTEXT_MANIFEST) {
      const directory = resolve(root, context.key);
      const files = await walk(directory);
      for (const file of files.filter((name) => name.endsWith(".ts"))) {
        const source = await readFile(file, "utf8");
        expect(source, file).not.toMatch(/from\s+["'][^"']*contexts\//);
        expect(source, file).not.toMatch(/from\s+["']\.\.\/[^"']*(identity-access|member|lottery|betting|wallet-ledger|payments|kyc-risk|promotion|result-settlement|notification|admin-approval|audit|reporting)/);
      }
    }
  });
});

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}
