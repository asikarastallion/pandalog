/**
 * Turning values into text. No arithmetic, and no unit conversion.
 *
 * **Canonical units only.** A report showing 2.0 deg beside a canonical 0.0349066 rad would be
 * more readable, and it would also put a number in the report that is not in the artifacts —
 * exactly what doc 04 §7 rules out. The conversion would be sound (core-domain owns the table) but
 * the archived record would then contain a number nothing upstream ever produced, and a reader
 * checking the report against the analysis would find a value that is not there. `apps/web` is
 * where a display unit belongs, because a screen is read and discarded; a report is filed.
 *
 * The convention that lets `no-calculation.test.ts` tell a measurement from an identifier:
 * **identifiers are wrapped in backticks, quantities never are.** Ids, hashes, versions and
 * timestamps are full of digits that are not measurements, and a traceability check unable to tell
 * them apart would have to ignore so much that it stopped meaning anything.
 */

/** Significant figures kept when a value is not exactly representable as a short decimal. */
const SIGNIFICANT_FIGURES = 6;

/**
 * A number as text, or an explicit absence.
 *
 * A non-finite value is never printed as 0 or omitted (doc 04 §1 rule 6): a report that silently
 * drops an unrecorded quantity reads as though it were never asked for.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'not recorded';
  }
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return String(value);
  }
  return String(Number.parseFloat(value.toPrecision(SIGNIFICANT_FIGURES)));
}

/** A measured quantity with its canonical unit. */
export const formatQuantity = (value: number, unit: string): string =>
  `${formatNumber(value)} ${unit}`;

/** A time window, in seconds on the dataset's own axis. */
export const formatWindow = (startSeconds: number, endSeconds: number): string =>
  `t = ${formatNumber(startSeconds)} s to ${formatNumber(endSeconds)} s`;

/** An identifier, marked as one. */
export const code = (value: string): string => `\`${value}\``;

/** A value the log did not carry, named rather than blanked. */
export const orNotLogged = (value: string | null): string =>
  value === null ? 'not logged' : code(value);

/** One markdown table, or a stated absence when there are no rows. */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  whenEmpty: string,
): string {
  if (rows.length === 0) {
    return whenEmpty;
  }
  const separator = headers.map(() => '---');
  return [headers, separator, ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');
}
