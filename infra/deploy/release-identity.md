# Release identity (traceable to a repository commit)

Every production deployment must record an identity that resolves back to a
pushed, CI-green commit. `runtime/release-sha` alone is not enough — the value
has to be provably a Git object of this repository, reachable from `origin/main`,
with green required checks on that exact SHA.

Audit finding F9 recorded the opposite: production `runtime/release-sha` was
`f646103441211511ec3f89fd6046ce474d7d125a`, which is not a Git object in this
repository, and the serving images were tagged `lottify-v2-api-build:e75a16a` /
`lottify-v2-admin:4563a1a`, neither of which resolves to a commit either. A
deployment and its rollback therefore cannot be tied to a reviewed candidate.

## Artifacts written to the deploy root

| Path | Contents |
| --- | --- |
| `runtime/release-sha` | the 40-hex source commit of the deployed candidate (single line) |
| `runtime/release-identity.json` | `schemaVersion`, `sourceCommit`, `sourceRepo`, `releaseTag`, `backendImage`, `ci{status,detail,runId}`, `legs[]`, `status`, `stampedAt` |

`status` is `VERIFIED` only when every leg passed. `UNVERIFIED-CI` means the
commit legs passed but no CI evidence was bound; such an identity is never a
release-ready identity.

## Usage

```bash
# 1. resolve a candidate ref to a commit object (fails on a non-object)
node infra/deploy/release-identity.mjs resolve <ref> --repo <pushed-clone>

# 2. plan/validate the identity before deploying (never writes anything)
gh api repos/<owner>/<repo>/commits/<sha>/check-runs > /tmp/check-runs.json
node infra/deploy/release-identity.mjs plan --repo <pushed-clone> \
  --candidate-sha <sha40> --candidate-image <name@sha256:...> \
  --release-tag <tag> --ci-evidence /tmp/check-runs.json

# 3. stamp the deploy root (dry-run first; --apply writes)
node infra/deploy/release-identity.mjs stamp ... --runtime-dir /home/ubuntu/lottify/runtime --apply

# 4. verify what is actually recorded (read-only; exit non-zero when untraceable)
node infra/deploy/release-identity.mjs verify --repo <pushed-clone> \
  --runtime-dir /home/ubuntu/lottify/runtime --ci-evidence /tmp/check-runs.json
```

Evidence format: either the raw `check-runs` API body
(`{ "head_sha", "check_runs": [...] }`) or a reduced summary
(`{ "head_sha", "checks": [{"name","conclusion"}] }`). Evidence is rejected
unless its `head_sha` equals the stamped candidate and every required check
(`--require-checks`, default `verify,container-smoke`) concluded `success`.

## Fail-closed rules

- A value that is not a commit object in the pushed clone is never stamped
  (`git cat-file -e <sha>^{commit}`).
- A commit that is not an ancestor of the pushed ref (default `origin/main`) is
  never stamped.
- CI evidence for a different commit is never accepted.
- A missing/unreadable CI evidence artifact leaves the `ci-green` leg
  `UNVERIFIED` and the tool exits `65` unless `--allow-unverified-ci` is passed
  deliberately; the record then carries `status: UNVERIFIED-CI`.
- `verify` also fails when `runtime/release-identity.json` is missing or when the
  recorded `backendImage` differs from the digest actually running
  (`--expect-image-digest`).

The tool never runs Docker, reloads a reverse proxy, changes traffic, mutates a
database, or reads secret values. `stamp` only writes the two identity files,
and only with `--apply`.

## Tests

`tests/unit/release-identity-cli.spec.ts` pins the behaviour against throwaway
Git repositories: it accepts a pushed commit with green evidence for the exact
SHA, and refuses the F9 value, foreign-SHA evidence, red required checks,
non-digest image references, and a missing identity record.
