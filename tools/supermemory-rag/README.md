# Lottify Supermemory RAG tooling

This is development/agent tooling for indexing approved Lottify reference material in Supermemory. It does not participate in Member/Admin runtime flows or authoritative business state.

## Scope

The ingest command indexes Markdown from:

- `.scratch/lottify-v1-specification/`
- `docs/agents/`
- `docs/implementation/`
- `workflows/`
- `AGENTS.md`, `CONTEXT.md`, and `README.md`

Documents are submitted with `taskType: "superrag"`. Searches use `searchMode: "documents"`.

## Setup

```bash
cd tools/supermemory-rag
npm install
export SUPERMEMORY_API_KEY="..."
```

The API key must come from the environment. Do not commit it.

The default project isolation tag is `lottify_v1_docs`. Override it only with a project-specific tag that matches `^[a-zA-Z0-9_:-]+$`:

```bash
export SUPERMEMORY_CONTAINER_TAG="lottify_v1_docs"
```

Never reuse this tag for another user or project, and never perform cross-tag queries.

## Ingest

```bash
npm run ingest
```

Each repository path gets a deterministic `customId`, so rerunning the command updates the same logical document instead of creating a second identity.

## Search

```bash
npm run search -- "withdrawal ambiguous provider outcome"
```

Use retrieved chunks as grounding for implementation work. Supermemory results are an index over the repository sources; the repository files remain the source of truth and must still be checked before changing product behavior.
