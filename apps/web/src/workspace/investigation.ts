/**
 * The investigation workflow — 03_ANALYSIS_AND_VERIFICATION.md §5.
 *
 * ```text
 * Finding → Evidence → Time Window → Synchronized Signals → Context → Conclusion
 * ```
 *
 * Doc 03 §5 is explicit that the UI "does not compute new findings; it navigates existing ones".
 * This module is that navigation, and it is a pure function over the pipeline's output — no Vue, no
 * DOM, no component. Selecting a finding is the app's central interaction, and if it could only be
 * exercised by mounting a component it would be in the wrong place (doc 04 §1 rules 1 and 3).
 *
 * Two decisions worth stating:
 *
 *   **Nothing is invented.** The window comes from the evidence and from the events the evidence
 *   cites. Optional padding is applied for legibility, but the unpadded evidence window travels
 *   alongside it so a reader can always see what the finding actually claimed as opposed to what is
 *   drawn around it.
 *
 *   **Failures to resolve are reported.** A signal the evidence names but the dataset lacks, or an
 *   event id with no event, lands in `unresolvedSignalIds`/`unresolvedEvidence` rather than being
 *   quietly skipped. An investigation that silently showed less than the evidence cited would let
 *   an engineer conclude from a partial view without knowing it was partial.
 */
import { evidenceTimeSpan, type EvidenceRef, type Finding } from '@pandalog/analysis';
import type { FlightEvent } from '@pandalog/events';
import { sliceByTime, type TimeWindow } from '@pandalog/query';
import type { CanonicalFlightDataset, Signal } from '@pandalog/schema';

/** Everything an investigation reads. Structurally a `PipelineResult`, narrowed to what is used. */
export interface InvestigationSource {
  readonly dataset: CanonicalFlightDataset;
  readonly events: readonly FlightEvent[];
  readonly findings: readonly Finding[];
}

export interface Investigation {
  readonly finding: Finding;
  /** The window actually displayed, including any padding. */
  readonly window: TimeWindow;
  /** The window the evidence itself covers, before padding. */
  readonly evidenceWindow: TimeWindow;
  /** Every cited signal plus any operator-chosen ones, each sliced to `window`. */
  readonly signals: readonly Signal[];
  /** Events the evidence names. */
  readonly citedEvents: readonly FlightEvent[];
  /** Signal ids that were asked for but are not in the dataset. */
  readonly unresolvedSignalIds: readonly string[];
  /** Evidence that could not be resolved — an event id with no matching event. */
  readonly unresolvedEvidence: readonly EvidenceRef[];
}

export interface OpenInvestigationOptions {
  /** Signals the operator added for context (doc 03 §5). */
  readonly extraSignalIds?: readonly string[];
  /** Context either side of the evidence window. Display only; `evidenceWindow` is unaffected. */
  readonly paddingSeconds?: number;
}

/**
 * Signal ids an evidence reference names, and whether the signal has to be there.
 *
 * A `signal-window` reference is a pointer: it says "look at this signal over this interval", and
 * if the signal is absent the investigation genuinely is showing less than the finding cited.
 *
 * A `measurement` reference is not a pointer — doc 03 §2 gives it `value` and `unit` of its own, so
 * it stands on its own evidence. Rules legitimately cite derived quantities this way (the attitude
 * rule cites the RMS error series it computed, which is a separate artifact per doc 02 §5 and is
 * not part of the dataset). Opening that signal is a bonus when it exists; its absence is not a
 * hole in the evidence, and reporting it as one would cry wolf on every such finding.
 */
function citedSignalId(reference: EvidenceRef): { id: string; required: boolean } | null {
  switch (reference.kind) {
    case 'signal-window':
      return { id: reference.signalId, required: true };
    case 'measurement':
      return { id: reference.signalId, required: false };
    case 'event':
      return null;
  }
}

interface ResolvedEvents {
  readonly citedEvents: FlightEvent[];
  readonly unresolvedEvidence: EvidenceRef[];
}

function resolveEvents(source: InvestigationSource, finding: Finding): ResolvedEvents {
  const citedEvents: FlightEvent[] = [];
  const unresolvedEvidence: EvidenceRef[] = [];

  for (const reference of finding.evidence) {
    if (reference.kind !== 'event') {
      continue;
    }
    const event = source.events.find((candidate) => candidate.id === reference.eventId);
    if (event === undefined) {
      unresolvedEvidence.push(reference);
    } else {
      citedEvents.push(event);
    }
  }

  return { citedEvents, unresolvedEvidence };
}

/**
 * Widen a span to cover the events the evidence cites.
 *
 * An event-backed finding often carries only the event reference and a measurement at its start, so
 * without this the window would collapse to an instant and the engineer would open a plot showing
 * nothing.
 */
function spanIncludingEvents(
  span: { startSeconds: number; endSeconds: number } | null,
  events: readonly FlightEvent[],
): TimeWindow | null {
  let start = span?.startSeconds ?? Number.POSITIVE_INFINITY;
  let end = span?.endSeconds ?? Number.NEGATIVE_INFINITY;

  for (const event of events) {
    start = Math.min(start, event.t_start_seconds);
    end = Math.max(end, event.t_end_seconds ?? event.t_start_seconds);
  }

  return Number.isFinite(start) && Number.isFinite(end)
    ? { startSeconds: start, endSeconds: end }
    : null;
}

/**
 * Resolve a finding into the view an engineer investigates it from.
 *
 * @returns `null` when no finding carries that id — the caller's selection is stale, which is a
 * different situation from a finding that resolves to nothing.
 */
export function openInvestigation(
  source: InvestigationSource,
  findingId: string,
  options: OpenInvestigationOptions = {},
): Investigation | null {
  const finding = source.findings.find((candidate) => candidate.id === findingId);
  if (finding === undefined) {
    return null;
  }

  const { citedEvents, unresolvedEvidence } = resolveEvents(source, finding);

  const evidenceWindow = spanIncludingEvents(evidenceTimeSpan(finding.evidence), citedEvents) ?? {
    startSeconds: 0,
    endSeconds: 0,
  };

  const padding = options.paddingSeconds ?? 0;
  const window: TimeWindow = {
    startSeconds: evidenceWindow.startSeconds - padding,
    endSeconds: evidenceWindow.endSeconds + padding,
  };

  // Order: signals the evidence names, then signals the cited events were detected from, then the
  // operator's own additions. Deduplicated, but the first mention wins so the finding's own
  // signals stay at the top of the plot.
  const wanted = new Map<string, boolean>();
  const remember = (id: string, required: boolean): void => {
    wanted.set(id, (wanted.get(id) ?? false) || required);
  };

  for (const reference of finding.evidence) {
    const cited = citedSignalId(reference);
    if (cited !== null) {
      remember(cited.id, cited.required);
    }
  }
  for (const event of citedEvents) {
    // A detector names the signals it drew its conclusion from; those must be openable or the
    // event's basis cannot be inspected.
    event.sourceSignalIds.forEach((id) => {
      remember(id, true);
    });
  }
  // The operator asked for these, so a missing one is worth saying — but it is their typo, not a
  // hole in the finding.
  (options.extraSignalIds ?? []).forEach((id) => {
    remember(id, true);
  });

  const signals: Signal[] = [];
  const unresolvedSignalIds: string[] = [];

  for (const [id, required] of wanted) {
    const signal = source.dataset.signals.get(id);
    if (signal === undefined) {
      if (required) {
        unresolvedSignalIds.push(id);
      }
    } else {
      signals.push(sliceByTime(signal, window));
    }
  }

  return {
    finding,
    window,
    evidenceWindow,
    signals,
    citedEvents,
    unresolvedSignalIds,
    unresolvedEvidence,
  };
}

export interface FindingAtTime {
  readonly finding: Finding;
  /** When the finding's evidence begins, or `0` when none of it is time-bounded. */
  readonly startSeconds: number;
}

/**
 * Findings in flight order.
 *
 * `runAnalysis` sorts by rule id so its output is stable regardless of registration order; an
 * engineer reading a flight wants them in the order they happened. A finding whose evidence carries
 * no time is kept at the start rather than dropped — it is still a claim about the flight.
 */
export function findingsByTime(findings: readonly Finding[]): readonly FindingAtTime[] {
  return findings
    .map((finding) => ({
      finding,
      startSeconds: evidenceTimeSpan(finding.evidence)?.startSeconds ?? 0,
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.finding.id.localeCompare(b.finding.id));
}
