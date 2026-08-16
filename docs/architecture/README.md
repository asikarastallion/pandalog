# Architecture

This directory indexes the architecture documents, holds the machine-checked dependency manifest,
and holds the ADRs for significant design decisions.

## Source-of-truth documents

The specification lives in the repository root, in this order:

| Document                                                                                 | Subject                                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`01_SYSTEM_ARCHITECTURE.md`](../../01_SYSTEM_ARCHITECTURE.md)                           | Package graph, pipeline stages, enforcement         |
| [`02_CANONICAL_DATA_MODEL.md`](../../02_CANONICAL_DATA_MODEL.md)                         | The one data model everything downstream consumes   |
| [`03_ANALYSIS_AND_VERIFICATION.md`](../../03_ANALYSIS_AND_VERIFICATION.md)               | Finding / Hypothesis / Verification contract        |
| [`04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`](../../04_CLAUDE_CODE_ENGINEERING_CONTRACT.md) | The enforceable engineering rule set                |
| [`05_IMPLEMENTATION_ROADMAP.md`](../../05_IMPLEMENTATION_ROADMAP.md)                     | Phase-by-phase deliverables and acceptance criteria |

## Dependency manifest

[`dependency-layers.json`](dependency-layers.json) is the authoritative, machine-readable package
graph. [`dependency-layers.schema.json`](dependency-layers.schema.json) describes its shape.

The manifest is not documentation of intent — it is read at test time by
[`tests/architecture/dependency-direction.test.ts`](../../tests/architecture/dependency-direction.test.ts),
which fails the build on an upward dependency, an undeclared import, or a `node:` import inside a
`platformNeutral` package. A structural change must update the manifest, `01_SYSTEM_ARCHITECTURE.md`,
and the code in the same commit (doc 01 §6).

## ADRs

| ADR                                                       | Decision                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| [ADR-0005](adr/0005-package-boundaries.md)                | Why the package graph is split the way it is                    |
| [ADR-0006](adr/0006-no-backend.md)                        | No backend: static client-side app plus a Node CLI              |
| [ADR-0007](adr/0007-validity-value-bearing-split.md)      | Validity invariant split into value-bearing / non-value-bearing |
| [ADR-0008](adr/0008-layer-numbers-follow-dependencies.md) | Layer numbers express dependency direction, not roadmap order   |
| [ADR-0009](adr/0009-dataflash-binary-only.md)             | Phase B decodes binary .BIN only; text .log is out of scope     |

ADR numbering starts at 0005 because doc 01 §2 and §4 already cite those identifiers; earlier
numbers are reserved for the decisions recorded directly in documents 01-05.
