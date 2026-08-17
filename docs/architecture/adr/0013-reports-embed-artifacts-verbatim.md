# ADR-0013 — A report embeds its artifacts verbatim and renders only canonical units

- **Status:** Accepted
- **Date:** 2026-08-17
- **Affects:** `05_IMPLEMENTATION_ROADMAP.md` Phase K, `@pandalog/reporting` (new),
  `@pandalog/analysis` (`AnalysisResult` gains `executedRules`), `@pandalog/pipeline`,
  `@pandalog/cli` (`--format=markdown`)

## Context

Doc 04 §7 states the rule this package lives under:

> `packages/reporting` renders structured artifacts (`Finding[]`, `VerificationResult[]`,
> comparison output); it performs no calculation of its own. If a number appears in a report that
> isn't traceable to `analysis`/`verification`/`comparison` output, that's a boundary violation.

It also requires every report to embed "source SHA-256, schema version, parser version, analysis
version, rule-set version, configuration used".

Two things about that turned out to need decisions rather than implementation.

**The rule is easy to state and easy to erode.** A report layer that projects artifacts into its
own view types is one helpful commit away from rounding a value, averaging two of them, or
converting a unit — each individually reasonable, and each producing a number that is in the report
and nowhere else. By the time anyone notices, the report and the analysis disagree and there is no
way to tell which is right.

**The rule-set version was not producible.** `AnalysisResult` carried findings, hypotheses and
`notApplicableRuleIds`. A rule that _applied and found nothing_ left no trace at all — it is absent
from the findings, absent from `notApplicableRuleIds`, and therefore indistinguishable from a rule
that was never registered. A report could not state what the flight had been checked against, which
is precisely what doc 04 §7 asks it to state.

## Decision

**1. The document embeds the artifacts unchanged.** `ReportDocument` holds the caller's
`Finding[]`, `Hypothesis[]`, `VerificationReport` and `ComparisonReport` by reference, not copies
or projections. What reporting adds is provenance, a tally, and an ordering.

**2. Reports render canonical units only.** No display conversion, in either the structured
document or the Markdown.

**3. `AnalysisResult` gains `executedRules: readonly RuleExecution[]`** — every registered rule with
the version it ran at and whether it applied. Additive; `notApplicableRuleIds` is unchanged.
`PipelineResult` carries it through, because the pipeline is the layer that chooses the rules.

**4. `generatedAtUtc` sits outside `provenance`.** Provenance answers "what was analysed, by what,
at which versions"; the clock answers "when was this printed".

**5. The CLI grows `--format=markdown`**, rendered from the same pipeline run as `--format=json`,
with the exit code unchanged by the choice.

## Reason

**On rule 1.** It converts the boundary from a habit into a property. "No number was invented" is
then `expect(document.findings).toEqual(input.findings)` — a test, not a review item. The mechanical
check goes further: `no-calculation.test.ts` extracts every number rendered as a quantity and
requires each to be present in the artifacts (or a tally of them, or a rounding within half an ulp
of one). It is paired with a test that computes the mean of the findings' measurements — the exact
"helpful" calculation §7 rules out — and confirms it appears nowhere.

**On rule 2, which costs something.** A report saying `0.174533 rad` is less readable than one
saying `10.0 deg`, and the conversion would be sound: `core-domain` owns the table and doc 04 §1
rule 7 sanctions it. It is still refused, because §7's test is not "is the number correct" but "is
the number traceable" — and a degree value appears in no artifact. An engineer checking a report
against the analysis would find a number that is not there.

The deciding difference is what the two surfaces are for. `apps/web` is read and closed, so it
converts freely and shows `basis` beside every threshold. A report is filed, cited, and re-read
after the tool has moved on; the archived record should contain what the pipeline produced, not a
presentation of it. Should this prove too painful, the honest fix is to render both — canonical as
the record and display alongside — not to replace one with the other.

**On rule 3.** "Checked and clean" and "never checked" is the same distinction doc 03 §3 draws
between `PASS` and `INCONCLUSIVE`, one layer down, and it was being lost. The gap was invisible
while nothing consumed rule provenance, which is why it survived Phase E; it became load-bearing the
moment a report had to name what the flight was verified against.

**On rule 4.** Phase K's acceptance criterion permits rendered output to differ between runs only in
"non-substantive metadata like generation timestamp, which is itself logged separately from
provenance". Mixing them would make every reprint of one analysis look like a different analysis.

## Consequences

- Reporting depends on `analysis`, `verification`, `comparison` and `schema` — not on
  `core-domain`, whose only relevance here was the unit conversion rule 2 declines to perform. The
  manifest allows it; the package does not use it.
- Reporting cannot resolve an event id to an event: `@pandalog/events` is not among its permitted
  dependencies (doc 01 §3), so event evidence renders as the id. The finding's own statement and
  measurements carry the substance, so this is a limitation rather than a hole — but resolving it
  would be a manifest change with its own ADR, not a quiet import.
- Anything constructing an `AnalysisResult` by hand must now supply `executedRules`.
- The Markdown convention **identifiers in backticks, quantities never** is load-bearing: it is what
  lets the traceability test tell `SHA-256` from a measurement. A renderer change that wraps a
  quantity in backticks would silently narrow that check.

## Alternatives rejected

- **Reporting-specific view types.** The projection layer is exactly where an invented number gets
  in, and it would make the strongest available test — deep equality against the input —
  impossible to write.
- **Rendering display units.** Covered under rule 2: readable, sound, and untraceable.
- **Deriving the rule-set version from the findings.** Only rules that fired produce findings, so
  the derived version would silently omit every rule that ran clean — the ones a reader most needs
  to know were checked.
- **A `Date.now()` inside `buildReport`.** Would make the reproducibility criterion untestable, and
  it is the same injected-clock decision the pipeline already made for `producedAtUtc`.
- **Emitting reports from a separate CLI command.** A second command could be pointed at a
  different log, or run at a different version, and produce a report that disagrees with the
  verification that gated the build. One run, two renderings, cannot.
