# 03 — Analysis, Findings, and Verification

Status: baseline. Owner packages: `@pandalog/events`, `@pandalog/analysis`,
`@pandalog/verification` (layers 5–7).

## 1. The layer distinction

PandaLog keeps four concepts strictly separate. Collapsing them into one is the single most
common way this kind of tool becomes untrustworthy.

```text
Measurement   — a number, with unit and validity, at a time. Not itself a claim.
Event         — a discrete, timestamped occurrence detected from measurements. Still a fact.
Finding       — an evidence-backed engineering statement: "X exceeded criterion Y". A claim.
Hypothesis    — a plausible, unconfirmed explanation for one or more findings. Not a fact.
```

```text
Example
Measurement : Roll RMS error = 6.2 deg over t=[102.4, 118.9]
Event       : "roll-tracking-window" opened at t=102.4, closed at t=118.9
Finding     : Roll tracking exceeded the configured criterion (6.2 deg > 5.0 deg threshold)
Hypothesis  : Possible actuator saturation contributed
Root cause  : Not established
```

Code must not produce a `Finding` that silently means "hypothesis," and must not produce a
`Hypothesis` labeled as an established `Finding`. The type system enforces this: `Hypothesis`
has no `verificationStatus` field; `Finding` has no `confidence` field implying speculation
beyond what its evidence supports.

## 2. Types

```ts
// packages/events/src/event.ts
export interface FlightEvent {
  id: string;
  type: string; // e.g. "mode-change", "gps-glitch", "vibration-excursion"
  t_start_seconds: number;
  t_end_seconds: number | null; // null for instantaneous events
  sourceSignalIds: string[]; // signals this event was detected from
  detector: { name: string; version: string };
  payload: Record<string, unknown>;
}
```

```ts
// packages/analysis/src/evidence.ts
export type EvidenceRef =
  | { kind: 'signal-window'; signalId: string; t_start_seconds: number; t_end_seconds: number }
  | { kind: 'event'; eventId: string }
  | { kind: 'measurement'; signalId: string; t_seconds: number; value: number; unit: string };

// packages/analysis/src/finding.ts
export type Severity = 'INFO' | 'ADVISORY' | 'WARNING' | 'CRITICAL';

export interface Finding {
  id: string;
  ruleId: string;
  ruleVersion: string; // semver of the rule implementation, see §4
  statement: string; // e.g. "Roll tracking exceeded the configured criterion"
  severity: Severity;
  /** MANDATORY. A Finding with an empty array is invalid and must be rejected at construction. */
  evidence: EvidenceRef[];
  measurements: Array<{ label: string; value: number; unit: string }>;
  thresholds: Array<{ label: string; value: number; unit: string; basis: string }>;
  producedAtUtc: string;
}

export interface Hypothesis {
  id: string;
  relatedFindingIds: string[];
  statement: string; // e.g. "Possible actuator saturation contributed"
  supportingEvidence: EvidenceRef[];
  /** Explicit acknowledgment this is not established. Never coexists with a PASS/FAIL claim. */
  status: 'UNCONFIRMED';
}
```

```ts
// packages/verification/src/requirement.ts
export type VerificationOutcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';

export interface RequirementDefinition {
  id: string;
  version: string; // semver; a requirement's logic changing is a version bump
  statement: string;
  appliesWhen: (ctx: RequirementContext) => boolean; // decides NOT_APPLICABLE
  evaluate: (ctx: RequirementContext) => VerificationResult;
}

export interface VerificationResult {
  requirementId: string;
  requirementVersion: string;
  outcome: VerificationOutcome;
  /** MANDATORY when outcome is PASS or FAIL. Missing evidence must yield INCONCLUSIVE, never PASS. */
  evidence: EvidenceRef[];
  reason: string;
  evaluatedAtUtc: string;
}
```

## 3. The mandatory-evidence rule

`Finding` construction is a validated operation, not a plain object literal in application
code: `packages/analysis` exposes `createFinding(input): Finding` which throws if
`evidence.length === 0`. There is no code path that produces a `Finding` without at least one
`EvidenceRef`. The same applies to `VerificationResult` with outcome `PASS` or `FAIL`: the
evaluator must attach evidence or the outcome must be `INCONCLUSIVE`.

This is the direct implementation of invariant 4.9 in `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`
("Evidence is mandatory") and of the hard rule "never convert missing evidence into PASS."

## 4. Rule definition contract

Every deterministic analysis rule (in `packages/analysis`) and every requirement (in
`packages/verification`) must be documented, in code, alongside its implementation, answering:

```text
inputs        — which signal ids / event types it consumes
formula       — the exact computation (comment or docstring, not just code)
units         — units of every quantity involved
thresholds    — every numeric constant, with basis (see below)
assumptions   — vehicle type / firmware / mode / sensor-availability assumptions
evidence      — what EvidenceRef(s) the rule attaches to its output
```

A threshold's "basis" is one of:

- `spec:<document/section>` — traceable to a written requirement or design limit;
- `empirical:<dataset/method>` — derived from fixture/golden data, with the derivation
  reproducible;
- `provisional` — explicitly marked as not yet justified; a rule/requirement in this state must
  say so in its `statement`/`reason` output, not present itself as settled.

A rule that depends on vehicle type, firmware, operating mode, or logging configuration must
branch on those explicitly in `appliesWhen`/its own applicability check — never bake a single
universal threshold that happens to work for the fixture at hand.

## 5. Investigation workflow (what the UI is for)

```text
Finding → Evidence → Time Window → Synchronized Signals → Context → Conclusion
```

Selecting a `Finding` in the UI resolves its `EvidenceRef[]` into a time window, opens every
signal referenced (plus operator-chosen related signals) synchronized on that window, and lets
the engineer move from evidence to a conclusion they write themselves or from a `Hypothesis`
the analysis layer proposed. The UI does not compute new findings; it navigates existing ones
and lets the engineer query `packages/query` for supporting context.

## 6. Determinism and reproducibility

Given the same `CanonicalFlightDataset`, the same rule/requirement versions, and the same
configuration, `packages/analysis` and `packages/verification` must produce byte-identical
`Finding`/`VerificationResult` sets. This is what makes reports reproducible (see
`04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §Reporting) and is directly tested: golden fixtures
(`fixtures/`) pair a canonical dataset with expected findings/verification output, re-run on
every CI build.

## 7. Where AI fits

`packages/ai` consumes `Finding[]`, `Hypothesis[]`, `VerificationResult[]` — it does not
receive raw signals directly and cannot manufacture a `Finding` or change a
`VerificationOutcome`. Its output type preserves the same layering:

```ts
export interface AiAnswer {
  facts: string[]; // restatements of Findings/VerificationResults, not new claims
  hypotheses: string[]; // may propose new Hypothesis-shaped statements, marked as such
  uncertainties: string[];
  evidenceRefs: EvidenceRef[]; // must resolve to real evidence already in the dataset
  recommendedChecks: string[];
}
```

If `packages/ai` is deleted, `packages/analysis`, `packages/verification`, `packages/cli`, and
`apps/web`'s core investigation workflow must still build and function.
