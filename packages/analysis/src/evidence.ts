/**
 * Evidence — 03_ANALYSIS_AND_VERIFICATION.md §2 and §3.
 *
 * Evidence is what separates a Finding from an opinion. Every reference must resolve to something
 * already in the dataset: a window of a signal, an event that was detected, or a single
 * measurement. The investigation workflow (doc 03 §5) depends on that — selecting a Finding
 * resolves its evidence into a time window and opens the signals it names.
 */
import { AnalysisError } from './errors.js';

export type EvidenceRef =
  | {
      readonly kind: 'signal-window';
      readonly signalId: string;
      readonly t_start_seconds: number;
      readonly t_end_seconds: number;
    }
  | { readonly kind: 'event'; readonly eventId: string }
  | {
      readonly kind: 'measurement';
      readonly signalId: string;
      readonly t_seconds: number;
      readonly value: number;
      readonly unit: string;
    };

function fail(message: string, context: Record<string, unknown>): never {
  throw new AnalysisError('INVALID_EVIDENCE', message, context);
}

/** Validate one evidence reference, returning it frozen. */
export function validateEvidenceRef(reference: EvidenceRef): EvidenceRef {
  switch (reference.kind) {
    case 'signal-window': {
      if (reference.signalId.length === 0) {
        fail('A signal-window evidence reference needs a signal id.', { reference });
      }
      if (
        !Number.isFinite(reference.t_start_seconds) ||
        !Number.isFinite(reference.t_end_seconds)
      ) {
        fail('A signal-window evidence reference needs finite bounds.', { reference });
      }
      if (reference.t_end_seconds < reference.t_start_seconds) {
        fail('A signal-window evidence reference cannot end before it starts.', { reference });
      }
      return Object.freeze({ ...reference });
    }
    case 'event': {
      if (reference.eventId.length === 0) {
        fail('An event evidence reference needs an event id.', { reference });
      }
      return Object.freeze({ ...reference });
    }
    case 'measurement': {
      if (reference.signalId.length === 0) {
        fail('A measurement evidence reference needs a signal id.', { reference });
      }
      if (!Number.isFinite(reference.t_seconds)) {
        fail('A measurement evidence reference needs a finite timestamp.', { reference });
      }
      if (!Number.isFinite(reference.value)) {
        // A measurement citing NaN proves nothing; the absence of data is not evidence *for*
        // anything, and a Finding resting on it would be unfalsifiable.
        fail('A measurement evidence reference must cite a finite value.', { reference });
      }
      if (reference.unit.length === 0) {
        fail('A measurement evidence reference must state its unit.', { reference });
      }
      return Object.freeze({ ...reference });
    }
    default:
      return assertNever(reference);
  }
}

/** Exhaustiveness guard: adding an EvidenceRef kind must fail to compile here (doc 04 §3). */
function assertNever(value: never): never {
  throw new AnalysisError('INVALID_EVIDENCE', 'Unhandled evidence kind.', { value });
}

/** The time span evidence points at, or null when none of it is time-bounded. */
export function evidenceTimeSpan(
  evidence: readonly EvidenceRef[],
): { startSeconds: number; endSeconds: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const reference of evidence) {
    if (reference.kind === 'signal-window') {
      start = Math.min(start, reference.t_start_seconds);
      end = Math.max(end, reference.t_end_seconds);
    } else if (reference.kind === 'measurement') {
      start = Math.min(start, reference.t_seconds);
      end = Math.max(end, reference.t_seconds);
    }
  }

  return Number.isFinite(start) && Number.isFinite(end)
    ? { startSeconds: start, endSeconds: end }
    : null;
}
