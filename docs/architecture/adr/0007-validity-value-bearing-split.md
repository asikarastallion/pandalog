# ADR-0007 — Validity invariant split into value-bearing / non-value-bearing

- **Status:** Accepted
- **Date:** 2026-08-16
- **Supersedes:** the original single-rule form of `02_CANONICAL_DATA_MODEL.md` §3 invariant 1
- **Affects:** `02_CANONICAL_DATA_MODEL.md` §2 and §3, `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §1
  rule 6, `05_IMPLEMENTATION_ROADMAP.md` Phase C acceptance, `packages/schema`

## Context

The canonical model originally stated one rule:

> `validity !== VALID` ⇒ `value` is `NaN`.

Separately, `Validity.INTERPOLATED` is defined as "derived by resampling/interpolation, not an
original sample", and Phase C is required to mark resampled points with it while propagating
`syncUncertaintySeconds`.

Read literally, the two cannot both hold. Every resampled point would be `INTERPOLATED`, therefore
non-`VALID`, therefore `NaN` — so resampling would produce a signal with no usable numbers at all,
and the query, events and analysis layers built on top of it would have nothing to read. The
conflict surfaced while implementing the Phase A validator, before any code depended on it.

## Decision

Split invariant 1 into two rules keyed on which group a validity state belongs to:

- **Value-bearing** — `VALID`, `INTERPOLATED` — the paired `value` **must be finite**. `NaN` or
  `±Infinity` is a violation.
- **Non-value-bearing** — `MISSING`, `INVALID`, `UNSUPPORTED` — the paired `value` **must be
  `NaN`**. A finite number is a violation.

The grouping is expressed once, as `VALUE_BEARING_VALIDITIES` in `packages/schema`, and every
check derives from it rather than restating the membership.

## Reason

`INTERPOLATED` means "a number produced by resampling or interpolation". By definition it carries a
usable value; forcing it to `NaN` empties the state of meaning and leaves the model unable to
express the ordinary result of a resample.

`NaN` is reserved for the cases where it is true and informative: there is genuinely no number
here. That is exactly `MISSING` (nothing was logged), `INVALID` (something was logged but failed a
declared check) and `UNSUPPORTED` (the source cannot provide this at all).

The split preserves what the original rule was protecting — a missing sensor reading can never
appear as `0`, and a consumer still cannot infer validity from the number — while making the
distinction the model actually needs: _is there a number here?_ rather than _was it measured?_ The
second question is still answerable, because the state itself says so.

## Consequences

- `VALUE_BEARING_VALIDITIES` is `{VALID, INTERPOLATED}`. Changing that set is a contract change
  requiring an ADR, not a refactor.
- Consumers must not treat `validity === VALID` as "has a usable number". The correct test is
  membership in the value-bearing set. A rule that means "measured, not interpolated" must say so
  explicitly — which is a legitimate thing for an analysis rule to require, and is now expressible.
- Phase C's resampler must decide, per output point, between `INTERPOLATED` + a finite value and
  `MISSING` + `NaN`. A gap too large to interpolate across is `MISSING`; it is not an interpolated
  value with a shrug attached.
- `propagateValidity` in `core-domain` ranks `INTERPOLATED` above the `NaN`-valued states and below
  `VALID`, so the two value-bearing states sit at the top of the trust order. Combining a
  value-bearing state with a non-value-bearing one yields a non-value-bearing result, which keeps
  invariants 1a/1b satisfiable under propagation.

## Alternatives rejected

- **Keep `NaN` for `INTERPOLATED` and carry the interpolated number in a separate field or flag.**
  Rejected: `Validity` exists precisely to describe the standing of a sample's value. Adding a
  second mechanism alongside it would create a parallel representation of the same fact, which
  `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §1 rule 4 forbids — "no parallel 'temporary'
  representation". Every downstream consumer would then have to read two fields to answer one
  question, and the two could disagree.
- **Drop `INTERPOLATED` from `Validity` and record interpolation only in `Signal.derivation`.**
  Rejected: `derivation` describes a whole signal, not individual samples. A resampled signal
  typically mixes points that had real support with points that did not, and that difference is
  per-sample information an analysis rule needs.
- **Leave the contradiction and let Phase C decide.** Rejected: doc 04 §11 requires the contract to
  be amended before downstream work is built on it, and the validator encoding the rule was being
  written now.
