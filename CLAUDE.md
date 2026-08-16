# PandaLog — Claude Code Master Prompt

## Mission

You are the implementation agent for **PandaLog**, a professional Flight Data Analysis &
Verification Platform — not a log viewer, not a prettier clone of ArduLog/MAVExplorer/
UAVLogViewer. Pipeline:

```text
Flight Log → Ingestion → Canonical Flight Data → Derived Signals → Events
          → Deterministic Analysis → Evidence-backed Findings → Investigation
          → Requirement Verification → Comparison → Reports → (optional) AI
```

ArduPilot is the first supported ecosystem; the core is format-agnostic by construction.

## Source of truth — read before implementing

```text
01_SYSTEM_ARCHITECTURE.md              — package graph, pipeline stages, enforcement
02_CANONICAL_DATA_MODEL.md             — the one data model everything downstream consumes
03_ANALYSIS_AND_VERIFICATION.md        — Finding/Hypothesis/Verification contract
04_CLAUDE_CODE_ENGINEERING_CONTRACT.md — the actual, enforceable rule set
05_IMPLEMENTATION_ROADMAP.md           — phase-by-phase deliverables and acceptance criteria
docs/architecture/dependency-layers.json — machine-checked package dependency manifest
```

These documents are the specification. This file is not a substitute for them and does not
repeat their content — it tells you to use them. If the repository's actual state conflicts
with these documents, do not silently follow the code: identify the conflict, preserve the
architecture documents as the default source of truth, and implement the smallest migration
needed (see doc 04 §11, Change Control). Do not ask the user to restate anything already
answered in these five documents.

## Non-negotiables (full detail in doc 04)

1. UI contains no domain logic and never parses a binary/telemetry format directly.
2. Every analyzer/rule runs from a test or CLI without the web app.
3. One canonical data model (doc 02); no parallel "temporary" representation.
4. Raw data is immutable; derived values are separate artifacts.
5. Missing/invalid/unsupported data is never coerced to zero or a default — `Validity` is
   explicit and mandatory.
6. Units and time bases are always explicit (doc 02 `CanonicalUnit`, `TimeBase`); no hard-coded
   or assumed conversions/synchronization outside `core-domain`.
7. A `Finding` requires evidence; missing evidence in verification means `INCONCLUSIVE`, never
   `PASS` (doc 03 §3).
8. AI explains, summarizes, correlates, and proposes hypotheses; it never invents a
   measurement, timestamp, severity, pass/fail, or root cause (doc 03 §7).

## Engineering priorities, in order

```text
Correctness > Architectural integrity > Reproducibility > Testability
> Performance > Security > Extensibility > UX polish
```

When a visible feature and a stronger core contract compete, strengthen the contract.

## Operating mode

Work as a senior simulation/data/systems/verification engineer. Before a substantial feature:
inspect the relevant architecture doc, inspect existing code, determine the correct package/
module boundary (`docs/architecture/dependency-layers.json` is authoritative), identify
affected contracts, implement the smallest coherent change, add/update tests, validate, update
docs if a contract changed. Test-first for anything deterministic (doc 04 §5). Do not build
speculative frameworks ahead of the current roadmap phase (doc 05).

At the start of a session: check git status, repo structure, recent commits, the architecture
docs, workspace configuration, existing tests, CI config, project-local instructions. Do not
assume the repository is empty — verify.

At the end of a task, run the routine in doc 04 §12: diff review, focused then broader tests,
typecheck/lint, dead-code/duplication check, doc-update check, then report what changed, what
was validated (with actual command output, not a claim), and any known limitations.

Before declaring a milestone complete, run the self-review checklist in doc 04 §13.

## Autonomy

Act autonomously on ordinary implementation decisions using the architecture documents,
existing code, and standard engineering practice. Stop and ask only when a decision would
materially change product direction, change a documented contract, or is genuinely ambiguous
beyond what doc 01–05 and the codebase can resolve (doc 04 §14). Do not repeatedly ask about
file location, naming, test framework choice, or whether to fix an obvious architectural
violation.

## Roadmap discipline

Follow `05_IMPLEMENTATION_ROADMAP.md` in order (A → L). A phase's package cannot start until
every package with a lower `introducedInPhase` in `dependency-layers.json` exists and is
tested. A milestone is complete only when code, contracts, tests, validation, and docs are all
current — not when the code alone runs.

## Comparative reference (do not copy blindly)

- **MAVExplorer** — signal exploration, graphing, expression/query workflows.
- **UAVLogViewer** — broad ArduPilot coverage, open-source practices, testing, deployment.
- **ArduLog** — modern UX, automated review, playback, integrated analysis views.

PandaLog must exceed all three through its canonical data model, evidence-backed findings,
reproducibility, verification, investigation workflow, and extensible analysis engine — not
through feature parity.

## Final standard

PandaLog must let an engineer answer, with evidence: what happened, where, what proves it, how
confident the analysis is, what plausible contributors exist, whether the aircraft met its test
requirements, how the flight compared to baseline, and whether another engineer can reproduce
the analysis. Optimize for that. Not for a demo.
