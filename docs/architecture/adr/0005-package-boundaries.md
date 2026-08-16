# ADR-0005 — Package boundaries are load-bearing, not organisational

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context source:** `01_SYSTEM_ARCHITECTURE.md` §3–§4 (this ADR records the decision that document
  summarises; the document remains the normative statement)

## Context

PandaLog's pipeline runs Flight Log → Ingestion → Canonical Flight Data → Derived Signals → Events →
Analysis → Verification → Comparison → Reporting → (optional) AI. That sequence could be built as
one package with internal folders, as a package per technical layer, or as a package per pipeline
stage.

The tool's value depends on claims an engineer can sign off on: what happened, what proves it, and
whether another engineer can reproduce it. That makes two properties non-negotiable — analysis must
be runnable without a UI, and a second source format must not require touching the analysis engine.

## Decision

One package per pipeline stage, with a declared, test-enforced dependency direction
(`dependency-layers.json`). Specifically:

- **`schema` has zero dependencies** so any future consumer — including one outside this repository,
  e.g. a Python analysis toolchain — can adopt the canonical model without inheriting unrelated code.
- **`core-domain` is separate from `ingestion`** so unit and time normalisation is testable and
  reusable without a parser, and a future non-ArduPilot adapter reuses it rather than
  reimplementing conversion.
- **`ingestion` is separate from `parser-ardupilot`** so the adapter _contract_ exists independently
  of any one format. Adding MAVLink or TLOG support means adding `parser-mavlink` / `parser-tlog`;
  it never means editing `ingestion`'s contract unless that contract is wrong for all adapters.
- **`analysis` depends on `events`, not the reverse**, because a finding is defined in terms of
  events and signals and never the other way around — which keeps event detection reusable by
  things that are not analysis, such as a timeline UI feature.
- **`verification` sits above `analysis`** because a requirement check consumes findings; it is not
  itself a finding.
- **`reporting` performs no calculation** and depends on `analysis`/`verification`/`comparison` only
  to render their output, which is why it does not sit inside them.
- **`ai` depends only on the read side of the evidence chain**, and nothing depends on `ai`.

## Consequences

- Deleting `packages/ai` must leave every other package building and passing tests. This is the
  mechanical form of "if the AI layer is removed, the main product must still function", and it is
  Phase L's acceptance criterion.
- A new package requires a manifest entry, a layer assignment, and a roadmap phase _before_ code is
  written in it (doc 04 §2).
- The boundaries cost more ceremony than folders would: a cross-package change touches several
  `package.json` files and the manifest. That cost is accepted deliberately — it is what makes an
  upward dependency a build failure rather than a code-review opinion.

## Alternatives rejected

- **Single package with internal folders.** Nothing mechanically prevents the UI from importing a
  parser internal, or analysis from reaching into ingestion. The boundary would exist only in
  reviewers' memory.
- **Packages by technical layer** (`types/`, `services/`, `utils/`). Produces a `utils` grab-bag and
  hides the pipeline, which is the actual domain structure.
- **Analysis and verification in one package.** Collapses the Finding/Requirement distinction that
  doc 03 §1 identifies as the most common way this class of tool becomes untrustworthy.
