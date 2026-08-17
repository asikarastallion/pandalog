# ADR-0010 — The pipeline composition becomes a package, and the ArduPilot parser is platform-neutral

- **Status:** Accepted
- **Date:** 2026-08-17
- **Affects:** `01_SYSTEM_ARCHITECTURE.md` §3 (package graph, rules 3–4),
  `docs/architecture/dependency-layers.json` (new `@pandalog/pipeline` entry;
  `@pandalog/parser-ardupilot` `platformNeutral`), `@pandalog/cli`, `apps/web`

## Context

Phase G put the composition

```text
bytes → ingest → detect events → run analysis → verify requirements
```

in `packages/cli/src/pipeline.ts`, with a comment recording that it lived there only because the
CLI was its single consumer, and that a second consumer would be the moment to reconsider.

Phase H is that moment. `apps/web` must run the identical sequence in a Web Worker, and it cannot
import it from where it is: `@pandalog/cli` is an application package, and doc 01 §3 rule 2 forbids
anything depending on an application. The choice is to share the composition or to write it twice.

A second question falls out of the same requirement. Doc 01 §2 states that the browser runs the
same ingestion and parsing code as Node:

> the exact same ingestion/analysis/verification/reporting code runs unmodified inside a browser
> Worker or inside the Node CLI

But `@pandalog/parser-ardupilot` is recorded as `platformNeutral: false`, and doc 01 §3 rule 4 lists
it among the packages "allowed platform-specific code". So the promise doc 01 §2 makes is not one
the architecture test enforces: a `node:fs` import could be added to the DataFlash decoder tomorrow
and every check would still pass, while the web app silently stopped being buildable.

## Decision

**1. `@pandalog/pipeline` (layer 8, `platformNeutral: true`)** holds the composition. It exports
`runPipeline` and the `PipelineResult` type. `@pandalog/cli` and `apps/web` both depend on it and
neither reimplements it. Layer 8 was previously unoccupied — the graph ran 7 → 9 — and an
orchestration layer sitting above `verification` and below `reporting` is what that slot is for.

**2. `@pandalog/parser-ardupilot` is marked `platformNeutral: true`.** Doc 01 §3 rule 4 is amended
to drop it from the list of packages allowed platform-specific code.

## Reason

**On the package.** What the composition holds is not five function calls; it is _policy_ — which
detectors run, which rules run, which requirement set is the default. Two applications making those
choices independently is how one tool starts giving two answers to the same question, and a user
comparing a CI run against the same log opened in the browser would have no way to tell which was
right. Doc 04's prohibition on a parallel representation is aimed at data, but the reasoning
transfers directly to the sequence that produces it.

Duplicating twenty lines is cheap on the day it is written and expensive on the day one copy gains
a requirement-set option and the other does not.

**On the parser.** It is already platform-neutral and has been since Phase B: it imports no
`node:*` builtin, and its `tsconfig.json` sets `types: []`, so Node globals are not even visible to
it. Nothing changes in the code — the flag is corrected to describe what the package is.

The flag is worth correcting rather than leaving conservative because it is the difference between
a promise and a check. Doc 01 §2's claim that the browser runs the same parser is load-bearing for
Phase H's Web Worker, and after this change the architecture test fails the build if anyone
weakens it. CLAUDE.md's ordering is explicit that a stronger core contract wins over convenience.

## Consequences

- A future non-ArduPilot adapter that genuinely needs platform APIs (a network-fetched log, a
  streaming reader over a file handle) declares `platformNeutral: false` for itself. It does not
  reopen this one.
- `@pandalog/cli` keeps its own `runCli`, argument parsing, exit codes and JSON document; only the
  composition moved. The CLI remains the place where a terminal is assumed.
- `apps/web` depends on `@pandalog/pipeline`, not on `@pandalog/cli`. The application boundary rule
  (doc 01 §3 rule 2) stays intact and is still enforced.
- The pipeline package must stay free of `node:*` imports, which the architecture test now checks —
  file reading stays in each application, which is where the two genuinely differ.

## Alternatives rejected

- **Duplicate the composition in `apps/web`.** Rejected above: it is the policy, not the plumbing,
  that would be duplicated.
- **Let `apps/web` import `@pandalog/cli`.** Violates doc 01 §3 rule 2 and would make a browser
  bundle depend on a package whose entry point reads `process.argv`.
- **Promote it earlier, during Phase G.** Would have created a package with one consumer on the
  strength of a predicted second one. Doc 05's roadmap discipline says not to; the prediction turned
  out right, but it was still a prediction when it was made.
- **Leave the parser `platformNeutral: false` and rely on review.** Keeps doc 01 §2's central
  claim unenforced, which is what the architecture test exists to prevent.
