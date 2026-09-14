import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import Supermemory from "supermemory";
import { assertContainerTag } from "./container-tag.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const containerTag = process.env.SUPERMEMORY_CONTAINER_TAG ?? "lottify_v1_docs";
const includeRoots = [
  ".scratch/lottify-v1-specification",
  "docs/agents",
  "docs/implementation",
  "workflows",
];
const includeFiles = ["AGENTS.md", "CONTEXT.md", "README.md"];

assertContainerTag(containerTag, "SUPERMEMORY_CONTAINER_TAG");
if (!process.env.SUPERMEMORY_API_KEY) {
  throw new Error("SUPERMEMORY_API_KEY is required");
}

const client = new Supermemory();
const files = [
  ...(await Promise.all(includeRoots.map((path) => collectMarkdown(resolve(repoRoot, path))))).flat(),
  ...includeFiles.map((path) => resolve(repoRoot, path)),
].sort();

let ingested = 0;
for (const file of files) {
  const content = await readFile(file, "utf8");
  const path = relative(repoRoot, file).split(sep).join("/");
  const customId = `lottify-doc-${createHash("sha256").update(path).digest("hex").slice(0, 32)}`;

  await client.add({
    content,
    containerTag,
    customId,
    filepath: path,
    taskType: "superrag",
    metadata: {
      repository: "lottify",
      path,
      source: "repository",
    },
  });
  ingested += 1;
  console.log(`queued ${path}`);
}

console.log(`queued ${ingested} documents in ${containerTag}`);

async function collectMarkdown(root) {
  try {
    if (!(await stat(root)).isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) return collectMarkdown(fullPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  }));
  return nested.flat();
}
