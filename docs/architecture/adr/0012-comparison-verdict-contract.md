# ADR-0012 — A comparison reports `INCOMPARABLE`, and never calls an unexamined axis "the same"

- **Status:** Accepted
- **Date:** 2026-08-17
- **Affects:** `05_IMPLEMENTATION_ROADMAP.md` Phase J, `@pandalog/comparison` (new), and the
  packages that will consume its output — `@pandalog/reporting` (Phase K) and `@pandalog/ai`
  (Phase L)

## Context

Phase J introduces types that cross a package boundary: `ComparisonReport`, `ComparisonVerdict`,
`ComparisonSubject` and the per-axis result shapes. Doc 04 §1 rule 4 requires such types to live in
`packages/schema` or to be justified here.

They are not canonical flight data. A `CanonicalFlightDataset` is what a vehicle recorded; a
comparison report is a statement _about two of them_, produced by this package, consumed only by
reporting and AI. Putting it in `packages/schema` would make layer 0 — which today has zero
dependencies and describes only measurements — carry the vocabulary of an analysis product. Doc 02
§1 is explicit that the canonical model is what everything downstream consumes; a comparison result
is downstream, not model.

The second and more consequential question is what a comparison is allowed to say.

Phase J's acceptance criterion is that a fixture compared against itself yields "no material
difference" on every axis. That criterion is passed perfectly by a function that returns "no
difference" unconditionally. And the ways a real comparison fails are quiet ones — different time
origins, a signal whose canonical unit changed, windows that never overlap, two reports answering
different requirement sets, a stretch where neither flight logged anything usable. Every one of
those leaves the code returning normally with nothing to report, which under a boolean is
indistinguishable from a clean result.

That is the same structural hazard doc 03 §3 identifies for verification — an answer that asserts
something while resting on nothing — one stage further down the pipeline.

## Decision

**1. The comparison vocabulary lives in `@pandalog/comparison`, not in `packages/schema`.** The
package is layer 9 and both its consumers (`reporting`, `ai`) already depend on it in
`dependency-layers.json`, so no dependency is added and no layer-0 type is introduced. The canonical
model gains nothing, which is the point.

**2. A comparison has three answers, not two:** `SAME`, `DIFFERENT`, `INCOMPARABLE`. `INCOMPARABLE`
is to comparison what `INCONCLUSIVE` is to verification — a legitimate, defined outcome, not an
error — and every incomparable result carries a `reason` naming what blocked it.

**3. An axis that was not compared is never reported as showing no difference.** Concretely:

- `combineVerdicts` returns `DIFFERENT` if any axis established a difference; otherwise
  `INCOMPARABLE` if any axis could not be checked; `SAME` only when every axis was compared and
  none differed. An empty set of axes is `INCOMPARABLE`.
- A comparison across two different requirement sets, or two versions of one set, is
  `INCOMPARABLE` on the verification axis rather than matched by requirement id.
- Two signals that carry no usable value on either side are `INCOMPARABLE`, not equal.

**4. Materiality is judged only where a threshold can declare its basis.** The two numeric
tolerances comparison introduces — a relative signal tolerance and an event-timing tolerance — are
`ComparisonTolerance` values carrying `ThresholdBasis` from `@pandalog/analysis`, are validated at
entry, and are published in the report. Findings and verification get no tolerance at all: severity
and outcome are the judgements of the packages that own them.

**5. Cross-flight time alignment is elapsed-time only, and says what it does not establish.** Two
flights may be laid over each other when their `TimeBase.origin` matches; there is no absolute
alignment, and no alignment at all across differing origins.

## Reason

**On rule 3, which is the substance of this ADR.** The failure it prevents is specific and severe.
An engineer comparing a new sortie against a qualified baseline is asking "did anything get worse".
A tool that answers "nothing got worse" when what actually happened is "I could not check" has not
given a weak answer — it has given the wrong one, in the direction that ends an investigation.
Making that state unrepresentable in the return type is cheaper than remembering to check for it,
and it is exactly the move doc 03 §3 already makes one stage earlier.

The granularity matters and is deliberately split. A _signal_ that could not be compared is
`INCOMPARABLE` and stays so. The signals _axis_ is `INCOMPARABLE` only when nothing on it could be
compared: a flight where forty-seven signals matched point by point and three were never logged by
either side has been compared, and reporting the whole axis as unexaminable would discard
forty-seven real results in order to describe three absences. The caveat is carried instead by
`SignalsComparison.incomparable`, which names them.

**On rule 4.** Comparison is downstream of analysis, and a threshold invented here could disagree
with the rule that already judged the same data. When a rule says WARNING in both flights it has
answered the materiality question against a threshold that declares where it came from (doc 03 §4);
a second opinion computed from the measurement delta would, on disagreement, have the comparison
contradicting the analysis it is reporting. So measurement deltas are reported as measurements and
the verdict follows severity.

**On rule 5.** Elapsed alignment needs no shared clock, which is why an unstated
`syncUncertaintySeconds` does not block it — that field measures distance from UTC truth, and
nothing here maps to UTC. What it needs is for both zeros to mean the same event, which a matching
`TimeOrigin` asserts and a differing one denies. Absolute alignment is not offered because two
flights flown at different times do not overlap on an absolute axis at all.

## Consequences

- `reporting` (Phase K) must render three verdict states, and cannot collapse `INCOMPARABLE` into a
  pass/fail styling. A report that shows only a green/red axis would reintroduce the failure this
  decision exists to prevent.
- `ai` (Phase L) receives `INCOMPARABLE` as data. Doc 03 §7 already forbids it inventing a
  pass/fail; this adds that it must not narrate an incomparable axis as an equivalent one.
- Two flights on different time origins still produce a useful report — signal distributions, event
  counts, findings and verification are all alignment-free — with the weaker basis labelled on each
  axis rather than stated once and forgotten.
- The default tolerances are `provisional`. They are honest defaults, not engineering criteria, and
  replacing them with justified ones is a per-programme decision the API already accepts.

## Alternatives rejected

- **A boolean `identical` flag.** The failure mode this whole ADR is about: it cannot distinguish
  "checked and equivalent" from "could not check", and the second is the one that matters.
- **Throwing on an incomparable pair.** A comparison that fails on one axis is still worth reading
  on the other three, and an exception would discard them. Verification made the same call for the
  same reason (doc 03 §3).
- **Putting the comparison types in `packages/schema`.** Would make layer 0 — the description of
  what a vehicle recorded — carry the vocabulary of a downstream analysis product, for no gain:
  both consumers already depend on `@pandalog/comparison` directly.
- **A single absolute signal tolerance.** One number cannot serve a roll angle in radians and a
  battery current in amps; it would have to be wrong for one of them. The tolerance is a fraction of
  the baseline signal's own range instead, which also matches the question being asked — a deviation
  matters relative to how much the signal was moving anyway.
- **Deriving materiality for findings from measurement deltas.** Covered under rule 4: it puts this
  package in the position of overruling the rule that owns the judgement.
