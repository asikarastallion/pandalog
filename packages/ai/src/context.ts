/**
 * What the model is allowed to see — 03_ANALYSIS_AND_VERIFICATION.md §7.
 *
 * > `packages/ai` consumes `Finding[]`, `Hypothesis[]`, `VerificationResult[]` — it does not
 * > receive raw signals directly and cannot manufacture a `Finding` or change a
 * > `VerificationOutcome`.
 *
 * `AiContext` has no field for a dataset or a signal, so that first clause is enforced by the type
 * rather than by remembering: a caller can hand `buildAiContext` an entire `PipelineResult` and the
 * signals are simply not carried across.
 *
 * Two things are also deliberately *not* sent, beyond what doc 03 requires. The source file name and
 * its SHA-256 identify the flight and add nothing to an explanation, and opting into AI already
 * means the findings leave the machine (doc 04 §8) — there is no reason for the log's identity to
 * go with them. Nothing is uploaded that does not have to be.
 */
import type { Finding, Hypothesis } from '@pandalog/analysis';
import type { ComparisonReport } from '@pandalog/comparison';
import type { VerificationResult } from '@pandalog/verification';

export interface AiContext {
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly outcomes: readonly VerificationResult[];
  readonly comparison: ComparisonReport | null;
}

export interface AiContextInput {
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly verification: { readonly results: readonly VerificationResult[] };
  readonly comparison?: ComparisonReport;
}

/**
 * Build the evidence view the model is given.
 *
 * Accepts anything carrying the four artifacts — a `PipelineResult` fits — and copies across only
 * the conclusions. Everything else in the input, signals included, is left behind.
 */
export function buildAiContext(input: AiContextInput): AiContext {
  return Object.freeze({
    findings: input.findings,
    hypotheses: input.hypotheses,
    outcomes: input.verification.results,
    comparison: input.comparison ?? null,
  });
}

const INSTRUCTIONS = `You are assisting a flight-test engineer reading an automated analysis of one
flight. Everything below was produced by deterministic rules and a requirement evaluator.

You may explain what the results mean, summarise them, point out correlations between them, and
propose hypotheses that would account for them.

You must not invent a measurement, a timestamp, a severity, a pass/fail outcome, or a root cause.
Every number you write must already appear above. Every evidence reference you cite must be one
listed above, copied exactly. If you state a requirement's outcome, state the one recorded here.
Where the results do not support a conclusion, say so in "uncertainties" rather than filling the gap.

The criteria behind these results are provisional: they do not trace to a flight-test document, so a
PASS means a placeholder criterion was met. Do not present them as settled requirements.

Answer with JSON only, in this shape:
{
  "facts": [],            // restatements of the results above, not new claims
  "hypotheses": [],       // possible explanations, explicitly unconfirmed
  "uncertainties": [],    // what these results cannot establish
  "evidenceRefs": [],     // copied exactly from the evidence listed above
  "recommendedChecks": [] // what an engineer should look at next
}`;

const describeEvidence = (reference: Finding['evidence'][number]): string => {
  switch (reference.kind) {
    case 'signal-window':
      return `{"kind":"signal-window","signalId":"${reference.signalId}","t_start_seconds":${String(reference.t_start_seconds)},"t_end_seconds":${String(reference.t_end_seconds)}}`;
    case 'event':
      return `{"kind":"event","eventId":"${reference.eventId}"}`;
    case 'measurement':
      return `{"kind":"measurement","signalId":"${reference.signalId}","t_seconds":${String(reference.t_seconds)},"value":${String(reference.value)},"unit":"${reference.unit}"}`;
  }
};

function renderFinding(finding: Finding): string {
  const lines = [`- ${finding.ruleId} [${finding.severity}]: ${finding.statement}`];

  for (const measurement of finding.measurements) {
    lines.push(
      `  measurement ${measurement.label} = ${String(measurement.value)} ${measurement.unit}`,
    );
  }
  for (const threshold of finding.thresholds) {
    lines.push(
      `  threshold ${threshold.label} = ${String(threshold.value)} ${threshold.unit} (basis: ${threshold.basis})`,
    );
  }
  for (const reference of finding.evidence) {
    lines.push(`  evidence ${describeEvidence(reference)}`);
  }

  return lines.join('\n');
}

const section = (heading: string, body: readonly string[], whenEmpty: string): string =>
  `${heading}\n${body.length === 0 ? whenEmpty : body.join('\n')}`;

/** Render the context as the prompt actually sent. Deterministic: same context, same string. */
export function renderContext(context: AiContext): string {
  const parts: string[] = [
    section('FINDINGS', context.findings.map(renderFinding), '(none)'),
    section(
      'HYPOTHESES ALREADY PROPOSED',
      context.hypotheses.map((hypothesis) => `- [${hypothesis.status}] ${hypothesis.statement}`),
      '(none)',
    ),
    section(
      'VERIFICATION OUTCOMES',
      context.outcomes.map(
        (outcome) => `- ${outcome.requirementId}: ${outcome.outcome} — ${outcome.reason}`,
      ),
      '(none)',
    ),
  ];

  if (context.comparison !== null) {
    const comparison = context.comparison;
    parts.push(
      [
        'COMPARISON AGAINST A BASELINE FLIGHT',
        `- overall: ${comparison.verdict}`,
        `- signals: ${comparison.signals.verdict}`,
        `- events: ${comparison.events.verdict}`,
        `- findings: ${comparison.findings.verdict}`,
        `- verification: ${comparison.verification.verdict}`,
        `- regressed: ${comparison.verification.regressions.join(', ') || '(none)'}`,
        // INCOMPARABLE is data, not a shrug (ADR-0012). The model is told what it means so it
        // cannot narrate an unexamined axis as one that agreed.
        '- note: an axis reported INCOMPARABLE was not compared at all. It does not mean the two',
        '  flights agreed on it, and must not be described as though it did.',
      ].join('\n'),
    );
  }

  return `${parts.join('\n\n')}\n\n${INSTRUCTIONS}\n`;
}
