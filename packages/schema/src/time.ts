/**
 * Time base — 02_CANONICAL_DATA_MODEL.md §2.
 *
 * Every dataset carries exactly one TimeBase describing how t_rel_seconds was produced. Consumers
 * must not assume UTC, monotonicity beyond what is declared, or synchronization across two
 * datasets without checking syncUncertaintySeconds.
 */

export const TIME_ORIGINS = [
  'BOOT', // t_rel_seconds = 0 at flight-controller boot
  'ARM', // t_rel_seconds = 0 at vehicle arm event
  'LOG_START', // t_rel_seconds = 0 at first record in the source file
  'UTC_EPOCH', // t_rel_seconds is UTC-referenced (only when the source proves this)
] as const;

export type TimeOrigin = (typeof TIME_ORIGINS)[number];

const TIME_ORIGIN_SET: ReadonlySet<string> = new Set<string>(TIME_ORIGINS);

export function isTimeOrigin(value: unknown): value is TimeOrigin {
  return typeof value === 'string' && TIME_ORIGIN_SET.has(value);
}

export interface TimeBase {
  readonly origin: TimeOrigin;
  /** Wall-clock UTC instant corresponding to t_rel_seconds = 0, if known. Null if unknown. */
  readonly epochUtc: string | null; // ISO-8601
  /**
   * Estimated one-sigma uncertainty, in seconds, between this TimeBase and UTC truth.
   * null = unknown/unestablished. 0 is a real claim (e.g. GPS-disciplined) and must never be
   * used as a stand-in for "unknown".
   */
  readonly syncUncertaintySeconds: number | null;
  /** True if the source declares a uniform sample interval; false if timestamps are sample-carried. */
  readonly uniformlySampled: boolean;
}
