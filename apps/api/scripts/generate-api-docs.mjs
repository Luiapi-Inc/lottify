import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const sourcePath = resolve(root, "apps/api/openapi/openapi.json");
const snapshotPath = resolve(root, "docs/api/openapi.json");
const markdownPath = resolve(root, "docs/api/api-specification.md");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];
const METHOD_ORDER = new Map(HTTP_METHODS.map((method, index) => [method, index]));

const document = JSON.parse(readFileSync(sourcePath, "utf8"));

function schemaLabel(schema) {
  if (!schema) return "unspecified";
  if (schema.$ref) return `\`${schema.$ref.split("/").at(-1)}\``;
  if (Array.isArray(schema.allOf)) return schema.allOf.map(schemaLabel).join(" & ");
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(schemaLabel).join(" | ");
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(schemaLabel).join(" | ");
  if (schema.type === "array") return `array<${schemaLabel(schema.items)}>`;
  if (schema.type) {
    const format = schema.format ? ` (${schema.format})` : "";
    return `\`${schema.type}${format}\``;
  }
  return "object";
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function operationEntries(prefix) {
  const entries = [];
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!path.startsWith(prefix)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      entries.push({ path, method, operation, pathItem });
    }
  }
  entries.sort((a, b) =>
    a.path.localeCompare(b.path) ||
    (METHOD_ORDER.get(a.method) ?? 99) - (METHOD_ORDER.get(b.method) ?? 99),
  );
  return entries;
}

function groupName(path, prefix) {
  const rest = path.slice(prefix.length).replace(/^\//, "");
  return rest.split("/")[0] || "root";
}

function anchor(scope, group) {
  return `${scope}-${group}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parameterType(parameter) {
  if (parameter?.schema) return schemaLabel(parameter.schema);
  if (parameter?.content) {
    const content = Object.values(parameter.content)[0];
    return schemaLabel(content?.schema);
  }
  return "unspecified";
}

function renderOperation({ path, method, operation, pathItem }) {
  const lines = [`#### \`${method.toUpperCase()} ${path}\``, ""];
  if (operation.summary) lines.push(`*${operation.summary}*`, "");
  if (operation.description && operation.description !== operation.summary) {
    lines.push(operation.description.trim(), "");
  }

  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .filter((parameter) => parameter && !parameter.$ref);
  if (parameters.length > 0) {
    lines.push("| param | in | type | required |", "|---|---|---|---|");
    for (const parameter of parameters) {
      lines.push(
        `| \`${escapeCell(parameter.name)}\` | ${escapeCell(parameter.in)} | ${escapeCell(parameterType(parameter))} | ${parameter.required ? "yes" : "no"} |`,
      );
    }
    lines.push("");
  }

  for (const [contentType, body] of Object.entries(operation.requestBody?.content ?? {})) {
    lines.push(`- **Request** \`${contentType}\`: ${schemaLabel(body?.schema)}`, "");
  }

  const responses = Object.entries(operation.responses ?? {}).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (responses.length > 0) {
    lines.push("- **Responses:**");
    for (const [status, response] of responses) {
      const jsonSchema = response?.content?.["application/json"]?.schema;
      const fallbackContent = Object.values(response?.content ?? {})[0];
      const label = schemaLabel(jsonSchema ?? fallbackContent?.schema);
      const suffix = label === "unspecified" ? (response?.description ? ` — ${response.description}` : "") : ` → ${label}`;
      lines.push(`  - \`${status}\`${suffix}`);
    }
    lines.push("");
  }

  return lines;
}

function renderScopedApi(title, prefix, scope) {
  const entries = operationEntries(prefix);
  const groups = new Map();
  for (const entry of entries) {
    const group = groupName(entry.path, prefix);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }

  const lines = [`## ${title}`, ""];
  for (const group of [...groups.keys()].sort()) {
    lines.push(`<a id="${anchor(scope, group)}"></a>`, `### \`/${scope}/${group}\``, "");
    for (const entry of groups.get(group)) lines.push(...renderOperation(entry));
  }
  return { lines, groups: [...groups.keys()].sort() };
}

function renderSchemas() {
  const schemas = Object.entries(document.components?.schemas ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const lines = ["## Schemas", ""];
  for (const [name, schema] of schemas) {
    lines.push(`### \`${name}\``, "");
    if (schema.description) lines.push(schema.description.trim(), "");
    if (schema.type === "object" || schema.properties) {
      const required = new Set(schema.required ?? []);
      const properties = Object.entries(schema.properties ?? {});
      if (properties.length > 0) {
        lines.push("| property | type | required |", "|---|---|---|");
        for (const [property, propertySchema] of properties) {
          lines.push(`| \`${escapeCell(property)}\` | ${escapeCell(schemaLabel(propertySchema))} | ${required.has(property) ? "yes" : "no"} |`);
        }
        lines.push("");
      } else {
        lines.push(`${schemaLabel(schema)}`, "");
      }
    } else {
      lines.push(`${schemaLabel(schema)}`, "");
    }
  }
  return lines;
}

const member = renderScopedApi("Member API", "/api/v1/member", "member");
const admin = renderScopedApi("Admin API", "/api/v1/admin", "admin");
const commonEntries = Object.entries(document.paths ?? {}).filter(
  ([path]) => !path.startsWith("/api/v1/member") && !path.startsWith("/api/v1/admin"),
);
const pathCount = Object.keys(document.paths ?? {}).length;
const operationCount = Object.values(document.paths ?? {}).reduce(
  (total, pathItem) => total + HTTP_METHODS.filter((method) => Boolean(pathItem?.[method])).length,
  0,
);
const schemaCount = Object.keys(document.components?.schemas ?? {}).length;

const lines = [
  "# Lottify v1 — API Specification (complete)",
  "",
  "Generated deterministically from the authoritative OpenAPI contract at `apps/api/openapi/openapi.json`.",
  "",
  `**${pathCount} paths · ${operationCount} operations · ${schemaCount} schemas**`,
  "",
  "Source: `apps/api/openapi/openapi.json` · regenerate with `pnpm openapi:generate`.",
  "",
  "## Contents",
  "",
  "- **Member API**",
  ...member.groups.map((group) => `  - [\`/member/${group}\`](#${anchor("member", group)})`),
  "- **Admin API**",
  ...admin.groups.map((group) => `  - [\`/admin/${group}\`](#${anchor("admin", group)})`),
];
if (commonEntries.length > 0) lines.push("- **Common API** — [root operations](#common-api)");
lines.push("- **Schemas** — [component schemas](#schemas)", "", "---", "", ...member.lines, ...admin.lines);

if (commonEntries.length > 0) {
  lines.push("## Common API", "");
  const commonOps = operationEntries("/api/v1").filter(
    ({ path }) => !path.startsWith("/api/v1/member") && !path.startsWith("/api/v1/admin"),
  );
  for (const entry of commonOps) lines.push(...renderOperation(entry));
}

lines.push(...renderSchemas());

mkdirSync(dirname(snapshotPath), { recursive: true });
copyFileSync(sourcePath, snapshotPath);
writeFileSync(markdownPath, `${lines.join("\n").trimEnd()}\n`, "utf8");

if (process.env.GITHUB_ACTIONS === "true") {
  execFileSync(
    "git",
    ["diff", "--exit-code", "--", "docs/api/openapi.json", "docs/api/api-specification.md"],
    { cwd: root, stdio: "inherit" },
  );
}
