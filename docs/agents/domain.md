# Domain Docs

This repo uses a single-context domain documentation layout for engineering skills.

## Before exploring

- Read the root `CONTEXT.md` and use its canonical domain vocabulary.
- Read ADRs under `docs/adr/` that affect the area being changed.
- If a relevant domain term or decision is missing, do not invent one silently; treat that as a domain-modeling gap.

If an expected ADR directory or document does not exist, proceed without treating its absence as an error.

## Layout

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Vocabulary

When naming domain concepts in specifications, issues, implementation plans, APIs, tests, or reviews, use the terms defined in `CONTEXT.md` and avoid synonyms that the glossary explicitly rejects.

## ADR conflicts

If proposed work conflicts with an existing ADR, surface the conflict explicitly before changing the architecture or implementation direction.
