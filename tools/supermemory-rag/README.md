# Lottify Supermemory integration tooling

This package contains the approved Supermemory integration primitives for Lottify. It has two separate scopes:

1. developer/agent document RAG over approved repository sources; and
2. reusable member-scoped memory/profile primitives for a future member-facing AI flow.

It does **not** replace authoritative Lottify business state. Member profile, phone, account status, KYC, Terms, financial state, eligibility, and other domain facts remain owned by the existing Lottify contexts and database.

## Setup

```bash
cd tools/supermemory-rag
npm install
export SUPERMEMORY_API_KEY="..."
```

The API key must come from the environment. Do not commit or print it.

All tags must use the singular `containerTag` field, match `^[a-zA-Z0-9_:-]+$`, be at most 100 characters, and never be cross-queried.

## Developer / agent document RAG

The ingest command indexes Markdown from:

- `.scratch/lottify-v1-specification/`
- `docs/agents/`
- `docs/implementation/`
- `workflows/`
- `AGENTS.md`, `CONTEXT.md`, and `README.md`

Documents are submitted with `taskType: "superrag"`. Searches use `searchMode: "documents"`.

The default project isolation tag is `lottify_v1_docs`. Override it only with another project-specific valid tag:

```bash
export SUPERMEMORY_CONTAINER_TAG="lottify_v1_docs"
```

Never reuse this tag for a different user or project.

### Ingest

```bash
npm run ingest
```

Each repository path gets a deterministic `customId`, so rerunning the command targets the same logical document identity.

### Search

```bash
npm run search -- "withdrawal ambiguous provider outcome"
```

Use retrieved chunks as grounding only. The repository remains the source of truth and must still be checked before changing product behavior.

### Agent workflow use

The Lottify Lead may use document search after reading the required source-of-truth files and before planning implementation:

```bash
npm --prefix tools/supermemory-rag run search -- "<short task-specific query>"
```

This lookup helps locate related repository material. It does not approve requirements, change ownership, or replace direct repository review. Ingest remains an explicit maintenance command and is never run automatically as part of a product workflow. Use only the project document tag in `SUPERMEMORY_CONTAINER_TAG`; never cross-query another project tag.

## Member-scoped memory primitives

`member-context.mjs` prepares the integration seam for a future authenticated member AI flow without adding a new product endpoint or changing existing Member behavior.

It exposes:

- `memberContainerTag(memberId)` → `member:<memberId>`; no phone number or other PII is used in the namespace.
- `searchMemberMemory(...)` → memory search with `searchMode: "memories"` before an AI model answers.
- `addMemberExchange(...)` → stores an exchange with `taskType: "memory"` after the model response.
- `getMemberMemoryProfile(...)` → reads Supermemory profile context for personalization.
- `createMemberMemoryClient()` → official `supermemory` SDK client using `SUPERMEMORY_API_KEY` from the environment.

A caller must always pass the authenticated Lottify `memberId`; the helper derives the tag internally and does not accept an arbitrary container tag. This prevents accidental cross-member queries.

Supermemory profile output is contextual AI personalization only. It must never be written back as authoritative Member profile, KYC, Terms, eligibility, account-status, or financial data without going through the owning Lottify domain workflow.

## Tests

```bash
npm test
```

The tests verify deterministic member tag derivation and that search, exchange ingestion, and profile lookup all stay inside the same member container.
