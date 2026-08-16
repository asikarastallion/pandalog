# PandaLog

**Professional Flight Data Analysis & Verification Platform.**

Not a flight log visualiser. PandaLog ingests flight data, normalises it into one canonical
model, derives engineering signals, detects events, produces evidence-backed findings, verifies
requirements, and generates reproducible reports.

```text
Flight Log → Ingestion → Canonical Flight Data → Derived Signals → Events
          → Deterministic Analysis → Evidence-backed Findings → Investigation
          → Requirement Verification → Comparison → Reports → (optional) AI
```

ArduPilot is the first supported ecosystem; the core is format-agnostic by construction — a new
source format is a new adapter, never a rewrite of the analysis engine.

**No backend.** PandaLog ships as a static, client-side web application (`apps/web`) plus a
Node CLI (`@pandalog/cli`) for headless/CI use. Flight logs are parsed and analysed entirely on
the user's machine; nothing is uploaded by default. See
[`01_SYSTEM_ARCHITECTURE.md`](01_SYSTEM_ARCHITECTURE.md) §2 for the deployment topology and why
every core package is built to run identically in a browser Worker or under Node.

## Status

Roadmap runs A → L (`05_IMPLEMENTATION_ROADMAP.md`). Current phase: **A — Foundation, complete;
B — ArduPilot DataFlash, next.**

Phase A means the three foundation packages exist, are tested, and are enforced: `pnpm verify` is
green and the architecture test fails the build on an upward dependency, an undeclared import, or
a `node:` import inside a package that must stay platform neutral.

There is no UI, CLI, or analysis engine yet — those are phases H, G, and E, and building them
before the data contracts were settled is exactly what the architecture forbids. Nothing can read
a real ArduPilot log yet either; that is Phase B, which is the first adapter written against the
contract in `@pandalog/ingestion`.

| Package                                         | Layer | Responsibility                                                                 | Phase |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------ | ----- |
| [`@pandalog/schema`](packages/schema)           | 0     | The canonical flight data model. Zero dependencies.                            | A ✅  |
| [`@pandalog/core-domain`](packages/core-domain) | 1     | Unit conversion, time normalisation, signal and dataset construction.          | A ✅  |
| [`@pandalog/ingestion`](packages/ingestion)     | 2     | Parser adapter contract, registry, canonicalization bridge.                    | A ✅  |
| `@pandalog/parser-ardupilot`                    | 3     | ArduPilot DataFlash decoding.                                                  | B     |
| `@pandalog/query`                               | 4     | Signal query, resampling, derived-signal registry.                             | C     |
| `@pandalog/events`                              | 5     | Flight event detection.                                                        | D     |
| `@pandalog/analysis`                            | 6     | Deterministic rules → evidence-backed findings.                                | E     |
| `@pandalog/verification`                        | 7     | Requirement definitions and evaluation.                                        | F     |
| `@pandalog/comparison`                          | 9     | Flight-vs-flight / flight-vs-baseline comparison.                              | J     |
| `@pandalog/reporting`                           | 10    | Reproducible report rendering (no calculation).                                | K     |
| `@pandalog/ai`                                  | 10    | Optional explanatory layer over evidence. Removable without breaking the rest. | L     |
| `@pandalog/cli`                                 | 11    | Headless ingest → analyze → verify → report.                                   | G     |
| `apps/web`                                      | 11    | Vue investigation workspace.                                                   | H     |

Layer number orders dependencies, not build order: `cli` and `web` arrive in phases G and H but
sit at the top because they consume everything beneath them (ADR-0008).

Every package's permitted dependencies are declared in
[`docs/architecture/dependency-layers.json`](docs/architecture/dependency-layers.json) and
checked by a test, not left to convention (see [Enforcement](#enforcement)).

## Getting started

```bash
pnpm install
pnpm verify     # typecheck → lint → test → build
```

| Script               | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `pnpm typecheck`     | Whole repo including tests, no emit      |
| `pnpm lint`          | ESLint with type-aware rules             |
| `pnpm test`          | Unit, integration and architecture tests |
| `pnpm test:coverage` | Same, with the 80% threshold enforced    |
| `pnpm build`         | `tsc -b` across project references       |
| `pnpm format`        | Prettier                                 |

Requires Node ≥ 20.11 and pnpm 9.

## Architecture

The documents in the repository root are the source of truth, in this order:

| Document                                                                           | Subject                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`01_SYSTEM_ARCHITECTURE.md`](01_SYSTEM_ARCHITECTURE.md)                           | Package graph, pipeline stages, enforcement         |
| [`02_CANONICAL_DATA_MODEL.md`](02_CANONICAL_DATA_MODEL.md)                         | The one data model everything downstream consumes   |
| [`03_ANALYSIS_AND_VERIFICATION.md`](03_ANALYSIS_AND_VERIFICATION.md)               | Finding / Hypothesis / Verification contract        |
| [`04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`](04_CLAUDE_CODE_ENGINEERING_CONTRACT.md) | The enforceable engineering rule set                |
| [`05_IMPLEMENTATION_ROADMAP.md`](05_IMPLEMENTATION_ROADMAP.md)                     | Phase-by-phase deliverables and acceptance criteria |

[`docs/architecture/`](docs/architecture) indexes them, holds the dependency manifest, and holds
the ADRs for significant design decisions.

### The invariants that shape the code

Not style preferences — this is why the packages are split the way they are.

- **One canonical model.** Adapters translate into it. Nothing invents a second representation.
- **Missing data is not zero.** An absent sample becomes `NaN` + `Validity.MISSING`; `NaN` means
  "there is genuinely no number here", so it never stands in for an interpolated one. Consumers
  read `validity`; they never infer it from a value.
- **Units are explicit.** Source units convert to canonical SI through one tested table. An
  unknown unit is an error, never an assumed identity.
- **Time is explicit.** Every dataset carries a `TimeBase` stating how its `t_rel_seconds` axis
  was produced. Unknown synchronisation uncertainty is recorded as `null`, never as `0`.
- **Raw data is immutable.** Derived values are separate artifacts.
- **Fail loudly.** A malformed log raises a structured error; it is never partially salvaged.
- **Analysis never depends on the UI.** Every engine must be runnable from a test or a CLI.
- **Evidence is mandatory.** A finding without at least one evidence reference cannot be
  constructed; missing evidence in verification is `INCONCLUSIVE`, never `PASS`.

### Enforcement

The dependency graph is checked by a test, not by convention:

```bash
pnpm test tests/architecture
```

[`tests/architecture/dependency-direction.test.ts`](tests/architecture/dependency-direction.test.ts)
reads the layer manifest and asserts both the declared dependencies and the actual imports. It
catches an upward dependency, an undeclared import, and a `node:` import in a package that must
stay platform-neutral. See [`tests/README.md`](tests/README.md) for the mutations that prove it
can fail.

## Repository layout

```text
packages/          implemented packages
apps/web/           Vue investigation workspace (from Phase H)
docs/architecture/  ADRs and the dependency-layer manifest
fixtures/           fixture logs and their expected outputs
tests/              integration and architecture tests
.github/workflows/  CI
```

## Contributing

`CLAUDE.md` points Claude Code at the documents above; `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`
is the actual rule set. In short:

1. read the architecture documents before changing a contract;
2. write the test first for anything deterministic;
3. if the architecture changes, amend the document and `dependency-layers.json` in the same
   change and add an ADR;
4. run `pnpm verify` before committing.
