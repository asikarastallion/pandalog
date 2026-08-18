# 04 — Claude Code Engineering Contract

Status: baseline. This document is the enforceable rule set. `CLAUDE.md` is the short prompt
that tells Claude Code to read and follow this document; this document contains the actual
rules so they exist once, not duplicated between the two.

## 1. Hard architectural boundaries

| #   | Rule                                                                                                                                         | Why                                                                            | Where it's checked                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | UI does not contain domain logic. Vue components call application/domain services and render their output.                                   | Keeps analysis runnable and testable without a browser.                        | Code review; no computation beyond formatting/derived-display-state inside `apps/web/src/components/**`.                                    |
| 2   | UI never decodes a binary/telemetry format directly.                                                                                         | Parsing is adapter territory; format changes must not touch the UI.            | `dependency-direction.test.ts` — `apps/web` cannot depend on internals of `parser-*`, only their public adapter output.                     |
| 3   | Every analyzer/rule is runnable from a test or the CLI without the web app.                                                                  | Analysis correctness must not depend on rendering.                             | Each rule in `packages/analysis`/`packages/verification` has a unit test invoking it directly.                                              |
| 4   | One canonical data model (`02_CANONICAL_DATA_MODEL.md`). No parallel "temporary" representation that outlives the change that introduced it. | Prevents silent drift between "the real model" and ad hoc shapes.              | Code review; new cross-package types must be added to `packages/schema` or justified in an ADR.                                             |
| 5   | Raw data is immutable; derived values are separate artifacts.                                                                                | Traceability — you can always get back to what was actually logged.            | `CanonicalFlightDataset`/`Signal` are `Readonly*`; derived signals carry a `derivation` block (§5 of doc 02).                               |
| 6   | Missing/invalid/unsupported/out-of-range data is never coerced to zero/healthy/default.                                                      | A missing sensor reading is not "0 m/s".                                       | `Validity` is mandatory on every `Sample`; the schema validator rejects a value-bearing sample (`VALID`, `INTERPOLATED`) carrying `NaN` and a non-value-bearing sample (`MISSING`, `INVALID`, `UNSUPPORTED`) carrying a finite value — doc 02 §3 invariants 1a/1b, ADR-0007. |
| 7   | Units are explicit; no hard-coded unit assumptions outside `core-domain`.                                                                    | Cross-format correctness.                                                      | `CanonicalUnit` is a required field; unit conversion only happens through `core-domain`'s table.                                            |
| 8   | Time is explicit; no assumed UTC/boot-relative/uniform/synchronized timestamps.                                                              | Cross-format correctness; multi-source correlation must state its uncertainty. | `TimeBase` required on every dataset and, where it differs, every signal.                                                                   |
| 9   | A finding must reference evidence; missing evidence in verification is `INCONCLUSIVE`, never `PASS`.                                         | This is what makes the tool trustworthy for engineering sign-off.              | `createFinding`/evaluator validation, see `03_ANALYSIS_AND_VERIFICATION.md` §3.                                                             |
| 10  | AI explains/summarizes/correlates/hypothesizes; it never invents measurements, timestamps, severity, pass/fail, or root cause.               | Keeps AI subordinate to deterministic analysis.                                | `packages/ai` type contract (`AiAnswer`) has no field that overrides a `VerificationOutcome` or fabricates a `Finding` — **and** `groundAnswer` re-checks every answer at runtime, rejecting any claim carrying a number the analysis did not produce, any evidence reference that does not resolve, and any statement asserting an outcome other than the recorded one (ADR-0014). The type alone is insufficient: every `AiAnswer` field is free text.                     |

## 2. Package and module boundaries

- Package boundaries are defined in `docs/architecture/dependency-layers.json` and explained in
  `01_SYSTEM_ARCHITECTURE.md`. A new package requires a manifest entry, a layer assignment, and
  a roadmap phase before code is written in it.
- Within a package, group by domain concept (e.g. `packages/analysis/src/rules/roll-tracking/`),
  not by technical layer (`controllers/`, `helpers/`, `utils/`). A `utils.ts` grab-bag that
  grows without a clear single responsibility is a signal to split it.
- Public package API is whatever is exported from the package's `index.ts`. Internal modules are
  not imported directly by other packages, even when TypeScript would allow it.

## 3. TypeScript conventions

- `strict: true` repo-wide, no `any` without an inline comment explaining why and what would be
  needed to remove it.
- Discriminated unions over boolean flags for anything with more than two meaningfully different
  shapes (e.g. `EvidenceRef.kind`, `VerificationOutcome`).
- Prefer `ReadonlyArray`/`ReadonlyMap`/`readonly` fields for any type that crosses a package
  boundary; mutability is a module-internal implementation detail, never a public shape.
- Exhaustiveness: `switch` over a union must have a `default: assertNever(x)` (or equivalent)
  so an added union member fails to compile everywhere it isn't handled.
- No silent `catch {}`. Every catch either rethrows a structured error, or handles a specific,
  named failure mode with a comment stating why swallowing it is correct here.

## 4. Errors

- Ingestion, analysis, and verification failures are structured errors with a stable `code`,
  a human-readable `message`, and enough context (file, offset, signal id, rule id) to act on
  without re-running with extra logging.
- "Fail loudly" means: a malformed log throws `IngestionError` and produces no
  `CanonicalFlightDataset`. It never returns a dataset with silently-dropped or
  silently-zeroed sections. Partial recovery, if ever supported, is an explicit, named mode
  the caller opts into — not the default.

## 5. Testing

- Test-first for anything deterministic: parser behavior, timestamp normalization, unit
  conversion, canonical construction, derived signals, event detection, analysis rules,
  evidence generation, verification results, CLI output, report generation.
- Every deterministic calculation gets: nominal case, boundary case, malformed-input case,
  missing-data case, extreme-value case. "Works on my sample log" is not sufficient evidence of
  correctness.
- Golden fixtures live in `fixtures/`: an input log (or synthetic canonical dataset) paired with
  an expected structured output, compared byte-for-byte/deep-equal in CI. Any new parser or
  deterministic analyzer needs at least one golden fixture before it's considered done.
- `pnpm test:coverage` enforces an 80% threshold repo-wide; packages below layer 8
  (`platformNeutral: true` packages) are expected to be near 100% given they contain the
  correctness-critical logic — coverage debt should concentrate in UI/CLI wiring, not domain
  code.
- Architecture tests (`tests/architecture/`) are part of the test suite, not a separate,
  optional check; `pnpm test` runs them.

## 6. Performance and large logs

- No heavy synchronous work (parsing, large signal transforms, FFT/DSP, analysis, report
  preparation) on the UI main thread — use Web Workers.
- Numeric time series use typed arrays; avoid storing the same numeric dataset in more than one
  representation at once.
- Rendering may downsample for display (LOD); analysis must operate on source-resolution data
  unless a rule explicitly documents its own resampling as part of its method (see
  `03_ANALYSIS_AND_VERIFICATION.md` §4, "formula").
- Design for real flight logs (tens of minutes at high log rates), not toy fixtures. When a
  feature would materially increase memory use, evaluate lazy loading, chunking, worker
  execution, cached derived signals, and IndexedDB before adding memory unconditionally.

## 7. Reporting

- `packages/reporting` renders structured artifacts (`Finding[]`, `VerificationResult[]`,
  `FlightEvent[]`, comparison output); it performs no calculation of its own. If a number appears
  in a report that isn't traceable to `analysis`/`verification`/`comparison` output, that's a
  boundary violation.
- **Two operations are rendering, a third is not.** *Tallying* the list being printed and
  *selecting* a value out of it (a maximum, an earliest, a latest) are rendering: the number
  printed is a number an artifact already contains. *Arithmetic over* them — a sum, a mean, a rate —
  produces a quantity nothing asserts and nothing evidences. A grouped view stating "24
  occurrences, peak 0.341 rad" is inside the line; the same view adding "totalling 87.3 s" is
  outside it, and the total belongs in a rule in `packages/analysis` that can carry evidence for
  it. Checked by `packages/reporting/test/no-calculation.test.ts` and `rollup.test.ts`.
- **A chart is held to the same rule in different terms.** A rendered SVG is thousands of
  coordinates, none of which is a measurement, so the numeric corpus check cannot see it. The
  equivalent guarantees are: every plotted point corresponds to a value-bearing sample, a
  non-value-bearing run breaks the line rather than being drawn through (§1 rule 6 in pixels), and
  moving one sample moves the output. Checked by `packages/reporting/test/chart.test.ts`.
- Every report embeds provenance: source SHA-256, schema version, parser version, analysis
  version, rule-set version, configuration used. Two runs against the same inputs and versions
  must produce the same report content.
- **A rendered form that cannot be reproduced must say so in its own body.** The Markdown, HTML,
  CSV and JSON exports are byte-reproducible; a PDF printed from the HTML is not, because page
  size, margins and font rasterisation belong to the browser that printed it. Stating that in a
  commit message or an ADR is not sufficient — the person who over-trusts the artifact is reading
  the artifact.

## 8. Security

- **No backend.** PandaLog is a static client-side application plus a Node CLI (doc 01 §2,
  ADR-0006); there is no PandaLog-operated server to secure, and no feature may quietly
  introduce one. A feature that seems to need server-side state is a product-defining decision
  requiring an ADR, not a default implementation path.
- Imported logs are untrusted input: validate file type, size, binary boundaries, message
  lengths, and numeric ranges where a sanity range is known, before trusting the content.
- No secret API keys embedded in the shipped `apps/web` bundle. Any key `packages/ai` uses is
  supplied by the user at runtime (e.g. stored client-side, entered per session) and sent
  directly from the client to the provider the user configured — never relayed through
  infrastructure PandaLog operates, because none exists.
- A user's flight logs are not uploaded anywhere by default. Any cloud/AI functionality
  (`packages/ai` reaching an external API) is opt-in, not on-by-default.

## 9. Dependencies

Before adding one: confirm it's necessary, check whether an existing dependency already covers
it, weigh bundle/runtime cost, check maintenance status and license compatibility, and consider
whether it has architectural impact (e.g. does it pull Node APIs into a `platformNeutral`
package). Convenience alone is not sufficient justification.

## 10. Git and commits

- Coherent, single-purpose commits, scoped by package where possible:
  `feat(core-domain): add unit conversion table`, `feat(analysis): add roll-tracking rule`.
- Before a meaningful commit: tests pass, typecheck passes, lint passes, `git diff` has been
  read end to end.
- No generated/build output committed.

## 11. Documentation and change control

- Architecture or public-contract changes update the relevant document (`01`–`03`, this
  document, or `dependency-layers.json`) in the same change as the code. Code-says-A,
  docs-say-B is not an acceptable interim state.
- Significant design decisions get an ADR under `docs/architecture/adr/`: decision, reason,
  alternatives rejected.
- When a requested feature conflicts with the architecture: identify the conflict, prefer the
  smallest architecture-preserving implementation, and if the contract genuinely must change,
  update the document and affected tests _before_ building the downstream feature on top of it.

## 12. Working session discipline

At the start of a session: check git status, repository structure, recent commits, the
architecture documents, current workspace configuration, existing tests, CI configuration, and
any project-local instructions. Don't assume the repository is empty or in a previously-assumed
state — verify.

Before implementing a substantial feature: inspect the relevant architecture doc, inspect
existing code in the affected package(s), determine the correct module boundary, identify
affected contracts, implement the smallest coherent change, add/update tests, run validation,
update documentation if a contract changed.

At the end of a task: inspect the diff, run focused then broader tests, run
typecheck/lint, check for dead code and duplicated logic, check whether docs need updates,
report what changed and what was validated, and state known limitations honestly — do not
report success without the evidence (test output, typecheck output) to back it.

**A limitation stated only in conversation is not recorded** (ADR-0015). A phase may be marked
complete in `05_IMPLEMENTATION_ROADMAP.md` with a deliverable outstanding, but only if that entry
itself names what is outstanding. A caveat that lives in a chat summary or a commit message has not
been written down: neither is where anyone looks to find out what the system does, and the roadmap
saying "complete" while the gap lives elsewhere is how a document starts overstating the product.

## 13. Self-review before declaring a milestone complete

```text
Did domain logic end up in the UI?
Was a second data model created instead of extending packages/schema?
Was missing data hidden instead of represented with Validity?
Are units hard-coded anywhere outside core-domain?
Are there unexamined assumptions (vehicle type, firmware, mode) baked into a threshold?
Was a dependency added without checking necessity/cost/license?
Does every Finding/PASS/FAIL outcome have evidence?
Did AI output replace or override a deterministic result anywhere?
Is any feature untestable without the UI?
Was unnecessary coupling introduced between packages?
Was a structural change checked against dependency-layers.json / the architecture test?
Did the test suite actually run, and pass, before declaring completion?
```

If any answer is "yes" where it shouldn't be, fix it before calling the milestone done.

## 14. Autonomy boundary

Claude Code should act autonomously on ordinary implementation decisions (file/module layout
within an already-defined package, naming consistent with existing conventions, test
structure, whether to refactor a clear boundary violation) without asking. It should stop and
ask only when a decision would materially change product direction, change a documented
contract, or is genuinely ambiguous beyond what the architecture documents, existing code, and
standard engineering practice can resolve.
