/**
 * REQ-ERR-001 — no flight-controller error was reported.
 *
 * This requirement is where "absence of evidence is not evidence of absence" gets decided in code.
 * The tempting implementation is: no error record in the log, therefore PASS. That converts missing
 * data into a pass, which doc 03 §3 forbids outright — the log might carry no error record because
 * nothing went wrong, or because the discrete-record stream was never captured at all.
 *
 * So the requirement asks a narrower question it can actually answer: *was a record stream examined,
 * and did it contain an error?* If the log carried discrete records and none was an error, that is a
 * PASS, and the first and last record examined are cited as the interval over which the claim
 * holds. If the log carried no records at all, nothing was examined and the outcome is INCONCLUSIVE.
 *
 * What this still cannot establish is whether error logging was *enabled* — no field in the
 * canonical dataset records the firmware's logging bitmask. That is stated as an assumption rather
 * than assumed away.
 */
import type { EvidenceRef } from '@pandalog/analysis';
import type { FlightEvent } from '@pandalog/events';

import type { RequirementContext, RequirementDefinition } from '../requirement.js';
import {
  asNonEmptyEvidence,
  recordFail,
  recordInconclusive,
  recordPass,
  type VerificationResult,
} from '../result.js';

const REQUIREMENT_ID = 'REQ-ERR-001';
const REQUIREMENT_VERSION = '1.0.0';

/**
 * Marker the source-log detectors put on events they read from the log's own records rather than
 * derived from a signal (`@pandalog/events` `detectors/source-log.ts`).
 */
const SOURCE_EVENT_PREFIX = 'sourceEvent:';

/** Event type the logged-error detector emits. */
const LOGGED_ERROR_TYPE = 'logged-error';

const isLoggedRecord = (event: FlightEvent): boolean =>
  typeof event.payload.source === 'string' && event.payload.source.startsWith(SOURCE_EVENT_PREFIX);

const byTime = (a: FlightEvent, b: FlightEvent): number =>
  a.t_start_seconds - b.t_start_seconds || a.id.localeCompare(b.id);

const cite = (event: FlightEvent): EvidenceRef => ({ kind: 'event', eventId: event.id });

/** The first and last record examined, which together bound the interval the claim covers. */
function boundingRecords(records: readonly FlightEvent[]): EvidenceRef[] {
  const [first] = records;
  const last = records[records.length - 1];

  if (first === undefined || last === undefined) {
    return [];
  }
  return first.id === last.id ? [cite(first)] : [cite(first), cite(last)];
}

function evaluate(context: RequirementContext): VerificationResult {
  const requirement = { id: REQUIREMENT_ID, version: REQUIREMENT_VERSION };
  const evaluatedAtUtc = context.now().toISOString();

  const records = context.events.filter(isLoggedRecord).sort(byTime);
  const errors = records.filter((event) => event.type === LOGGED_ERROR_TYPE);

  const cited = asNonEmptyEvidence(errors.map(cite));
  if (cited !== null) {
    return recordFail({
      requirement,
      evidence: cited,
      reason:
        `The log records ${String(errors.length)} flight-controller error(s), the first at ` +
        `t=${(errors[0]?.t_start_seconds ?? 0).toFixed(3)} s. What each error means is ` +
        'firmware-specific and is not interpreted here; the subsystem and error codes are carried ' +
        'in the cited events.',
      evaluatedAtUtc,
    });
  }

  const examined = asNonEmptyEvidence(boundingRecords(records));
  if (examined === null) {
    return recordInconclusive({
      requirement,
      reason:
        'The flight carried no discrete log records at all, so no record stream was examined. ' +
        'Finding no error in a stream that was never captured establishes nothing, and is ' +
        'recorded as inconclusive rather than as a pass.',
      evaluatedAtUtc,
    });
  }

  const first = records[0]?.t_start_seconds ?? 0;
  const last = records[records.length - 1]?.t_start_seconds ?? 0;

  return recordPass({
    requirement,
    evidence: examined,
    reason:
      `${String(records.length)} discrete log record(s) were examined over t=[${first.toFixed(3)}, ` +
      `${last.toFixed(3)}] and none was an error. This assumes the firmware's error logging was ` +
      'enabled; the canonical dataset carries no logging-bitmask field, so PandaLog cannot confirm ' +
      'it.',
    evaluatedAtUtc,
  });
}

export const NO_LOGGED_ERROR_REQUIREMENT: RequirementDefinition = {
  id: REQUIREMENT_ID,
  version: REQUIREMENT_VERSION,
  statement:
    'No flight-controller error shall be reported during the flight. (Provisional: derived from ' +
    'the log itself, not from a written test plan.)',

  documentation: {
    applicability:
      'Applies to every flight: any log can carry an error record, so no vehicle is exempt. What ' +
      'varies is whether a record stream was captured, which changes the outcome rather than the ' +
      'applicability.',
    inputs: ['event:logged-error', 'event:mode-change', 'event:logged-message', 'event:arm-disarm'],
    formula:
      'Select events the source-log detectors read from the log itself (payload.source begins ' +
      '"sourceEvent:"). FAIL when any is of type logged-error. Otherwise PASS when at least one ' +
      'record was examined, INCONCLUSIVE when none was.',
    units: 'None; the requirement counts records. Times in seconds on the dataset time base.',
    thresholds: [],
    assumptions: [
      'Error logging was enabled in firmware. The canonical dataset has no field recording the ' +
        'logging bitmask, so this cannot be checked and is stated in the PASS reason.',
      'Any logged error is treated as disqualifying, regardless of subsystem or severity. A real ' +
        'test plan would almost certainly exempt some, which is why this set is provisional.',
      'The source-log detectors ran. If they did not, no records are examined and the outcome is ' +
        'inconclusive rather than a pass.',
    ],
    evidence:
      'Every error event when the outcome is FAIL; the first and last record examined when the ' +
      'outcome is PASS, bounding the interval over which no error was found.',
  },

  appliesWhen: () => true,
  evaluate,
};
