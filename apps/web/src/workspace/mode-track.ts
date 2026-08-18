/**
 * Splitting a flown path by flight mode.
 *
 * The ground track, the 3D trajectory and the timeline all want the same thing: the path cut where
 * the mode changed, each piece carrying which mode it was flown in. The cut is shared so the three
 * views cannot disagree, and the colour assignment is `@pandalog/reporting`'s `assignModeColors`,
 * which the Summary charts also use — a mode that is blue on a chart and orange on the map is worse
 * than no colour at all.
 *
 * ## Two things this refuses to do
 *
 * **It does not join across a gap.** `buildGroundTrack` already broke the path wherever the GNSS
 * fix was lost, because a stretch with no fix is not a straight leg between the last position and
 * the next one. Splitting by mode subdivides those runs further; it never merges two of them, so a
 * mode boundary inside an outage produces two pieces with the hole still between them.
 *
 * **It does not interpolate a position at the mode change.** A mode changed at t = 41.3 s and the
 * nearest fixes are at 41.0 and 41.6; inventing the position at 41.3 to make the colours meet
 * exactly would be a coordinate no receiver reported (doc 04 §1 rule 6). The split falls on a real
 * sample, and the piece boundary is therefore approximate to one sample interval — which is stated
 * rather than hidden, because a reader comparing a colour edge against a mode-change timestamp will
 * otherwise find them disagreeing and not know why.
 */
import { assignModeColors, modeColorIndex, modeLabel } from '@pandalog/reporting';
import type { ModeSegment } from '@pandalog/events';

/** The minimum a point needs for this module to place it: a time. */
export interface TimedPoint {
  readonly tSeconds: number;
}

export interface ModePiece<TPoint extends TimedPoint> {
  /** Points in flight order. Never joined across a break in the source run. */
  readonly points: readonly TPoint[];
  readonly mode: number | null;
  readonly label: string;
  /** Palette slot, matching the charts and the legend. -1 for a period with no mode recorded. */
  readonly colorIndex: number;
  /** True when the mode this piece was flown in was inferred rather than recorded (ADR-0016). */
  readonly inferred: boolean;
}

/** The segment covering an instant, or null when the instant is outside every segment. */
function segmentAt(segments: readonly ModeSegment[], tSeconds: number): ModeSegment | null {
  for (const segment of segments) {
    if (tSeconds >= segment.startSeconds && tSeconds < segment.endSeconds) {
      return segment;
    }
  }
  // The final instant sits exactly on the last segment's closing bound, which the half-open test
  // above excludes. It belongs to that segment: the flight did not leave its mode by ending.
  const last = segments[segments.length - 1];
  return last?.endSeconds === tSeconds ? last : null;
}

/**
 * Cut each run of a path where the mode changed.
 *
 * Consecutive pieces share their boundary point, so the coloured path has no visual hole at a mode
 * change — the point at which the mode changed belongs to both the piece ending and the piece
 * beginning. That duplication is a rendering decision about one shared vertex, not an invented
 * sample: the point is one the log recorded, drawn twice.
 */
export function splitByMode<TPoint extends TimedPoint>(
  runs: readonly (readonly TPoint[])[],
  segments: readonly ModeSegment[],
): readonly ModePiece<TPoint>[] {
  const colors = assignModeColors(segments);
  const pieces: ModePiece<TPoint>[] = [];

  const push = (points: readonly TPoint[], segment: ModeSegment | null): void => {
    if (points.length === 0) {
      return;
    }
    const mode = segment?.mode ?? null;
    pieces.push({
      points,
      mode,
      label: modeLabel(mode),
      colorIndex: modeColorIndex(colors, mode),
      inferred: segment === null || !segment.startsAtLoggedChange || !segment.endsAtLoggedChange,
    });
  };

  for (const run of runs) {
    let current: TPoint[] = [];
    let currentSegment: ModeSegment | null = null;

    for (const point of run) {
      const segment = segmentAt(segments, point.tSeconds);

      if (current.length === 0) {
        current = [point];
        currentSegment = segment;
        continue;
      }

      if (segment === currentSegment) {
        current.push(point);
        continue;
      }

      // The mode changed at some instant between the previous point and this one. The path is cut
      // here, on a real sample, and the two pieces share this point so the line stays continuous.
      current.push(point);
      push(current, currentSegment);
      current = [point];
      currentSegment = segment;
    }

    push(current, currentSegment);
  }

  return pieces;
}

export interface ModeLegendEntry {
  readonly mode: number | null;
  readonly label: string;
  readonly colorIndex: number;
  readonly inferred: boolean;
}

/** One legend for a whole flight, in the order the modes were first flown. */
export function modeLegend(segments: readonly ModeSegment[]): readonly ModeLegendEntry[] {
  const colors = assignModeColors(segments);
  const seen = new Map<string, ModeLegendEntry>();

  for (const segment of segments) {
    const label = modeLabel(segment.mode);
    if (seen.has(label)) {
      continue;
    }
    seen.set(label, {
      mode: segment.mode,
      label,
      colorIndex: modeColorIndex(colors, segment.mode),
      inferred: !segment.startsAtLoggedChange || !segment.endsAtLoggedChange,
    });
  }

  return [...seen.values()];
}
