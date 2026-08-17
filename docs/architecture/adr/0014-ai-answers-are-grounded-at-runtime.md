# ADR-0014 — An AI answer is grounded at runtime, not only constrained by its type

- **Status:** Accepted
- **Date:** 2026-08-17
- **Affects:** `05_IMPLEMENTATION_ROADMAP.md` Phase L, `@pandalog/ai` (new),
  `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §1 rule 10 (enforcement column)

## Context

Doc 04 §1 rule 10 says AI "explains/summarizes/correlates/hypothesizes; it never invents
measurements, timestamps, severity, pass/fail, or root cause", and records where that is checked:

> `packages/ai` type contract (`AiAnswer`) has no field that overrides a `VerificationOutcome` or
> fabricates a `Finding`.

That is true, and building the package showed it is half the enforcement. Every field of `AiAnswer`
is free text. A model cannot return a `severity: 'CRITICAL'`, but it can return

```
facts: ["Peak vibration reached 91.7 m/s^2, so REQ-VIB-001 is effectively a PASS."]
```

which invents a measurement and overturns a verification outcome in one sentence, inside a field the
type permits. It is _worse_ than a structured override, because it reads like prose an engineer
would trust and nothing downstream can tell it from a correct restatement.

`@pandalog/reporting` is held to the same rule (doc 04 §7) and can satisfy it structurally: it is
code that either performs arithmetic or does not, so a test settles it once and for all. Here the
output is the adversary, it is different on every call, and no test written in advance can cover
what a model will say tomorrow.

## Decision

**1. Every answer is grounded at runtime, on every call.** `groundAnswer` checks three things and
`askAi` always applies it — there is no flag, and no API that returns an ungrounded answer:

- **Numbers.** Every number in a claim must already appear in the context, either as a numeric field
  of a finding, threshold, measurement, outcome or comparison, or inside the prose a rule wrote.
  Rounding is allowed within half a unit of the last digit written, so quoting `0.175 rad` for a
  measured `0.174533` is restating it. Anything further is a different number.
- **Evidence.** Every `EvidenceRef` must be structurally identical to one the deterministic layers
  produced. Not similar — identical.
- **Outcomes.** A claim naming a requirement must not assert an outcome other than the recorded one.

**2. A rejected claim is removed and listed, never silently dropped.** `GroundedAnswer` carries
`rejected: Rejection[]`, each naming the field, the text and the reason.

**3. Rejection is per claim, not per answer.** An answer that overreached in one sentence keeps the
rest.

**4. The context carries no provenance.** `AiContext` holds findings, hypotheses, outcomes and a
comparison — not the file name, not the SHA-256, not a signal.

**5. The client requires an explicit https endpoint and never stores the key.**

## Reason

**On rule 1.** It is the same check `@pandalog/reporting` passes, moved from build time to run time
because that is where the risk now is. The alternative — trusting the prompt — asks a probabilistic
system to enforce a safety property, which is the arrangement doc 03 §7 exists to avoid. The prompt
still says all of this, because a model told the rules breaks them less often; but the prompt is the
request and the guard is the enforcement, and they are not the same thing.

The rounding allowance is the one place judgement enters, and it is deliberately narrow. Too tight
and the guard rejects accurate restatements, which is how a check ends up switched off; too loose
and "roughly 90" grounds 91.7. Half a unit of the last digit _written_ keys the tolerance to the
model's own claimed precision, which is the only defensible reading of what it asserted.

**On rule 2.** A caller renders `facts` directly. A claim quietly dropped is invisible; a claim
quietly kept is read. The rejection list is also the more interesting half of the result when it is
non-empty — it says the model tried to overstate, which is worth surfacing to whoever is deciding
how much to trust this layer.

**On rule 3.** An all-or-nothing guard discards a correct summary because one sentence overreached,
and a guard that throws away good output is one a caller eventually turns off. Same reasoning as
`INCOMPARABLE` in ADR-0012 and `INCONCLUSIVE` in doc 03 §3: report precisely what failed, keep what
did not.

**On rule 4.** Doc 03 §7 requires only that raw signals are excluded, and the type does that by
having nowhere to put them. Excluding provenance goes further, and the reason is doc 04 §8: opting
in already means the findings leave the machine, and the file name and hash identify _which flight_
without helping explain it. Nothing should be uploaded that does not have to be.

**On rule 5.** Doc 04 §8 requires the key to be user-supplied and sent directly to the provider the
user configured. A default endpoint would mean findings going somewhere before the user named where,
so there is none. Plaintext is refused because the request carries both a credential and the
flight's findings. The key is captured in a closure rather than held as a property, so it cannot
reach a structured log, an error report, or a devtools inspection of the client object.

## Consequences

- `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §1 rule 10's enforcement column is updated in the same
  change to name the runtime guard alongside the type contract. The rule is unchanged; how it is
  checked is now stronger than the document described.
- A caller must handle `rejected` being non-empty. Rendering `answer` alone is safe — that is the
  point — but a UI that never shows rejections hides that the model overstated.
- The guard is conservative by construction and will occasionally reject a legitimate paraphrase: a
  model computing "the outage lasted about 3 seconds" from two timestamps has done arithmetic
  nothing in the context contains. That is the intended trade — this layer is not permitted to
  derive quantities, and a derived number is indistinguishable from an invented one at the boundary.
- Grounding is not a defence against a wrong _explanation_. A hypothesis using only real numbers can
  still be nonsense; it is a `Hypothesis`, marked unconfirmed, and doc 03 §1 already governs what
  that means.
- Nothing depends on `@pandalog/ai`, checked by `tests/architecture/ai-removable.test.ts` against
  the repository rather than the manifest: no source import, no `package.json` dependency, no
  tsconfig reference.

## Alternatives rejected

- **Trusting the system prompt.** Asks the model to enforce the constraint it is the risk to. The
  prompt is kept as a request, not relied on as a control.
- **Rejecting the whole answer on any ungrounded claim.** Covered under rule 3: it destroys good
  output and pressures a caller into bypassing the guard.
- **Flagging rather than removing.** Leaves the ungrounded sentence in the field a caller renders,
  which means it is displayed unless every caller remembers to filter — the wrong default for the
  one failure mode this package exists to prevent.
- **Letting AI write a `Hypothesis` into the analysis layer.** Would put model output into the
  artifact chain the report and the verification read, which doc 03 §7 rules out. Its hypotheses
  stay strings inside `AiAnswer`.
- **Shipping a default provider endpoint.** Convenient, and it would send a flight's findings to a
  destination the user never chose.
