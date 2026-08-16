# 01 — System Architecture

Status: baseline. This document defines the package graph, the pipeline stages, and the
boundaries that are enforced by `tests/architecture/dependency-direction.test.ts` against
`docs/architecture/dependency-layers.json`.

## 1. Pipeline

```text
Flight Log
    │  packages/parser-ardupilot (+ future parser-* adapters)
    ▼
Raw Source Records                         ── format-specific, adapter-internal only
    │  packages/ingestion (canonicalization bridge)
    ▼
CanonicalFlightDataset                     ── 02_CANONICAL_DATA_MODEL.md, immutable
    │  packages/query
    ▼
Derived Signals (typed, unit-explicit)
    │  packages/events
    ▼
Events (discrete, timestamped, evidenced)
    │  packages/analysis
    ▼
Findings + Hypotheses                      ── 03_ANALYSIS_AND_VERIFICATION.md
    │  packages/verification
    ▼
Verification Results (PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE)
    │  packages/comparison (optional, cross-flight)
    ▼
Comparison Results
    │  packages/reporting
    ▼
Reports (reproducible, provenance-stamped)
    │  packages/ai (optional)
    ▼
Structured AI Answers (explanatory only, never authoritative)
```

Every arrow is a package boundary. No stage reaches backward into an earlier stage's internals;
each stage consumes only the public output type of the stage before it.

## 2. Deployment topology (ADR-0006 summary)

**Decision: no backend.** PandaLog ships as two deployable artifacts, both consuming the same
`platformNeutral` core packages, with no server component in between:

- **`apps/web`** — a static single-page application. The user's flight log is read, parsed,
  analyzed, and verified entirely client-side (main thread orchestration, heavy work in Web
  Workers per §4). Nothing is uploaded. Persistence (parsed datasets, derived signals,
  findings, verification results, comparison baselines) uses IndexedDB. Deployable as static
  files to any static host (e.g. Netlify, Vercel, GitHub Pages, or a local `file://`/
  `pnpm --filter web preview` run) — there is no API server to provision, scale, or secure.
- **`@pandalog/cli`** — the same pipeline running headless under Node, for automation/CI use
  (a user's own flight-test pipeline running verification on every log).

Why this holds together: every package from `@pandalog/schema` through `@pandalog/reporting`
is `platformNeutral: true` (§1 table) — no `node:*` imports, no DOM assumptions — so the exact
same ingestion/analysis/verification/reporting code runs unmodified inside a browser Worker or
inside the Node CLI. `apps/web` and `@pandalog/cli` differ only in _how they invoke_ the core
pipeline and _where they read files from_ (File System Access API / drag-and-drop vs. the
filesystem), not in what the pipeline does.

Consequences this constrains going forward:

- No package may assume a server-side execution context (session storage, server database,
  server-side auth) for core functionality. If a future feature seems to need one, that is a
  product-defining decision requiring an ADR before implementation, not a default to reach for.
- `packages/ai` (Phase L, opt-in) is the one place an external network call is expected — it
  talks directly from the client (browser or CLI process) to whatever LLM provider the user has
  configured, using a key the user supplies. PandaLog does not proxy or relay this through
  infrastructure it operates.
- Multi-device sync, team sharing, or hosted storage are explicitly out of scope unless a future
  ADR revisits this decision; do not partially build toward them (e.g. no speculative
  server-shaped types in `packages/schema`).

## 3. Package graph

Authoritative machine-readable form: `docs/architecture/dependency-layers.json`. Summary:

| Layer | Package                      | Depends on                                                 | Phase |
| ----- | ---------------------------- | ---------------------------------------------------------- | ----- |
| 0     | `@pandalog/schema`           | —                                                          | A     |
| 1     | `@pandalog/core-domain`      | schema                                                     | A     |
| 2     | `@pandalog/ingestion`        | schema, core-domain                                        | A     |
| 3     | `@pandalog/parser-ardupilot` | schema, core-domain, ingestion                             | B     |
| 4     | `@pandalog/query`            | schema, core-domain                                        | C     |
| 5     | `@pandalog/events`           | schema, core-domain, query                                 | D     |
| 6     | `@pandalog/analysis`         | schema, core-domain, query, events                         | E     |
| 7     | `@pandalog/verification`     | schema, core-domain, query, events, analysis               | F     |
| 8     | `@pandalog/cli`              | everything through reporting                               | G     |
| 8     | `apps/web`                   | everything through reporting                               | H     |
| 9     | `@pandalog/comparison`       | schema, core-domain, query, events, analysis, verification | J     |
| 9     | `@pandalog/reporting`        | schema, core-domain, analysis, verification, comparison    | K     |
| 10    | `@pandalog/ai`               | schema, analysis, verification, comparison                 | L     |

Rules (enforced by test, see §5):

1. Dependencies only point toward lower layer numbers.
2. `apps/web` and `@pandalog/cli` are the only packages that may depend on the full stack; no
   package below layer 8 may import from either.
3. `@pandalog/schema` and `@pandalog/core-domain` and `@pandalog/query`, `@pandalog/events`,
   `@pandalog/analysis`, `@pandalog/verification`, `@pandalog/comparison`, `@pandalog/reporting`
   are `platformNeutral: true` — no `node:*` imports, runnable in a worker or in Node without
   modification.
4. `@pandalog/parser-ardupilot`, `@pandalog/cli`, `@pandalog/ai`, `apps/web` are allowed
   platform-specific code (file I/O, network, DOM) because their responsibility requires it.

## 4. Why this shape (ADR-0005 summary)

Each package is a load-bearing boundary, not an organizational convenience:

- **`schema` has zero dependencies** so that any future package — including ones outside this
  repository (e.g. a Python analysis toolchain) — can consume the canonical model without
  pulling in unrelated code.
- **`core-domain` is separate from `ingestion`** so that unit/time normalization logic is
  testable and reusable without a parser, and so a future non-ArduPilot adapter reuses it
  rather than reimplementing conversion.
- **`ingestion` is separate from `parser-ardupilot`** so the adapter _contract_ (what any
  parser must produce) exists independently of any one format. Adding MAVLink or TLOG support
  means adding `parser-mavlink`, `parser-tlog`; it never means editing `ingestion`'s contract
  unless the contract itself is wrong for all adapters.
- **`analysis` depends on `events`, not the reverse**, because a finding is defined in terms of
  events and signals, never the other way around — this keeps event detection reusable by
  things that are not analysis (e.g. a future timeline UI feature).
- **`verification` sits above `analysis`** because a requirement check consumes findings; it is
  not itself a finding.
- **`reporting` performs no calculation** (§19 of `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`) — it
  depends on `analysis`/`verification`/`comparison` only to _render_ their output, which is why
  it does not sit inside those packages.
- **`ai` depends only on the read side of the evidence chain** (`analysis`, `verification`,
  `comparison`, plus `schema`) and nothing depends on `ai` — deleting the package must not
  break any other package's build. This is the mechanical enforcement of "if the AI layer is
  removed, the main product must still function."

## 5. Application boundary (`apps/web`)

`apps/web` is a Vue 3 application. It:

- consumes application/domain services from the packages above the dependency line; it does
  not implement domain logic in components (see `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §UI
  boundary rules);
- never decodes a binary log format directly — decoding is `parser-*` package territory;
- runs heavy work (parsing, FFT, large signal transforms, analysis, report preparation) in Web
  Workers, not on the main thread;
- treats every domain object it renders as coming from a package type in `@pandalog/schema` /
  `@pandalog/analysis` / etc. — it does not define a parallel "UI model" that duplicates the
  canonical shapes. View-specific state (selection, zoom, active tab) is UI state; flight data,
  findings, and verification results are not.

## 6. Enforcement

`tests/architecture/dependency-direction.test.ts`:

1. loads `docs/architecture/dependency-layers.json`;
2. for each package, statically walks its source imports (via the TypeScript compiler API or
   an AST import scanner) and asserts every internal `@pandalog/*` import is present in that
   package's `allowedDependencies`;
3. asserts no `platformNeutral: true` package imports a `node:*` builtin;
4. asserts no package outside `apps/web`/`@pandalog/cli` imports either of them.

A structural change (new package, new allowed dependency, layer change) must update
`dependency-layers.json` and this document in the same commit; the test will fail otherwise
because a real import will have no corresponding manifest entry.

See `tests/README.md` for the specific mutation tests that prove the check can fail (upward
dependency, undeclared import, disallowed `node:` import).

## 7. Cross-cutting concerns

| Concern                             | Where it lives                                                 | Not allowed elsewhere                                         |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Unit conversion                     | `core-domain`                                                  | Hard-coded conversion factors anywhere else                   |
| Time normalization                  | `core-domain`                                                  | Ad hoc timestamp math in UI or analysis                       |
| Missing/invalid data representation | `schema` (`Validity`)                                          | Silent coercion to 0/default in any package                   |
| Evidence linkage                    | `analysis` (`Finding.evidence`)                                | A finding constructed without at least one evidence reference |
| Provenance (source hash, versions)  | `schema` (`SourceProvenance`), threaded through to `reporting` | Reports fabricating or omitting provenance                    |
| Configuration/thresholds            | `analysis` rule definitions, versioned                         | Inline magic numbers in rule implementations                  |
