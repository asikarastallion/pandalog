/**
 * Playback state at an instant — 05_IMPLEMENTATION_ROADMAP.md Phase I:
 *
 * > Playback position/attitude at a given timestamp matches the corresponding canonical signal
 * > values within documented interpolation tolerance.
 *
 * The tolerance is not this module's to invent. Sampling a signal between its samples is
 * interpolation, and interpolation belongs to `@pandalog/query` (doc 04 §1 rule 7) — so playback
 * asks `resampleSignal` for the instant it wants and reports what comes back. That inherits the
 * guarantee `resample.ts` already makes and tests: a point with two close-enough neighbours is
 * `INTERPOLATED` with a finite value, a point beyond the data or across too wide a gap is `MISSING`
 * with `NaN`, and nothing is ever extrapolated.
 *
 * Which makes the important behaviour fall out rather than needing to be bolted on: **while the
 * GNSS fix is lost, playback has no position.** It does not hold the last one, and it does not
 * interpolate across the outage to a plausible curve. A scrubber that kept flying the aircraft
 * through a dropout would be showing a path nobody recorded, which is doc 04 §1 rule 6 in motion.
 */
import { resampleSignal } from '@pandalog/query';
import {
  isValueBearing,
  Validity,
  type CanonicalFlightDataset,
  type Signal,
} from '@pandalog/schema';

/**
 * Widest gap playback will interpolate across.
 *
 * A display parameter, not a criterion about the aircraft. Half a second is chosen against the rate
 * these signals are logged at — attitude at 10-50 Hz, GNSS at 5-10 Hz — so an ordinary missed
 * sample is bridged while a real dropout is not. Interpolating an attitude across more than that
 * animates a pose the vehicle is not recorded as having held.
 */
export const DEFAULT_MAX_GAP_SECONDS = 0.5;

export const POSITION_SIGNAL_IDS = Object.freeze({
  latitude: 'gps.latitude',
  longitude: 'gps.longitude',
  altitude: 'gps.altitude',
});

export const ATTITUDE_SIGNAL_IDS = Object.freeze({
  roll: 'attitude.roll',
  pitch: 'attitude.pitch',
  yaw: 'attitude.yaw',
});

export interface PlaybackChannel {
  readonly signalId: string;
  /** Canonical units — radians for angles, metres for altitude. Never converted here. */
  readonly value: number;
  readonly validity: Validity;
}

export interface PlaybackPosition {
  readonly latitudeRad: number;
  readonly longitudeRad: number;
  /** Null when the log carries no usable altitude at this instant; position is still known. */
  readonly altitudeMeters: number | null;
}

export interface PlaybackAttitude {
  readonly rollRad: number;
  readonly pitchRad: number;
  readonly yawRad: number;
}

export interface PlaybackState {
  readonly tSeconds: number;
  /** Every requested channel, including the ones that had nothing — absence is reported. */
  readonly channels: ReadonlyMap<string, PlaybackChannel>;
  /** Null when latitude or longitude is not value-bearing. Half a position is not a position. */
  readonly position: PlaybackPosition | null;
  /** Null unless all three axes are value-bearing; a missing axis is never filled in with zero. */
  readonly attitude: PlaybackAttitude | null;
}

export interface PlaybackSource {
  readonly dataset: CanonicalFlightDataset;
}

export interface PlaybackOptions {
  readonly maxGapSeconds?: number;
  /** Extra signals to sample alongside position and attitude, for a readout. */
  readonly extraSignalIds?: readonly string[];
}

const ABSENT: PlaybackChannel = { signalId: '', value: NaN, validity: Validity.MISSING };

/**
 * Sample one signal at one instant, through the domain resampler.
 *
 * A signal the dataset does not carry yields UNSUPPORTED rather than MISSING: the vehicle never
 * logged it at all, which is a different statement from "no sample at this time" (doc 02 §2).
 */
function sampleAt(
  dataset: CanonicalFlightDataset,
  signalId: string,
  tSeconds: number,
  maxGapSeconds: number,
): PlaybackChannel {
  const signal: Signal | undefined = dataset.signals.get(signalId);
  if (signal === undefined) {
    return { ...ABSENT, signalId, validity: Validity.UNSUPPORTED };
  }

  const resampled = resampleSignal(signal, { times: [tSeconds], maxGapSeconds });
  const sample = resampled.samples[0];

  return sample === undefined
    ? { ...ABSENT, signalId }
    : { signalId, value: sample.value, validity: sample.validity };
}

/**
 * Whether a channel carries a number that means something.
 *
 * Exported so a component can ask rather than comparing `Validity` itself — the enum is the
 * domain's, and a component reasoning about it is a component reasoning about the model.
 */
export const channelIsUsable = (channel: PlaybackChannel | undefined): boolean =>
  channel !== undefined && isValueBearing(channel.validity) && Number.isFinite(channel.value);

const usable = channelIsUsable;

/**
 * The vehicle's state at `tSeconds`, as far as the log supports one.
 *
 * @param tSeconds instant on the dataset's time base.
 */
export function playbackStateAt(
  source: PlaybackSource,
  tSeconds: number,
  options: PlaybackOptions = {},
): PlaybackState {
  const maxGapSeconds = options.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;

  const wanted = [
    ...Object.values(POSITION_SIGNAL_IDS),
    ...Object.values(ATTITUDE_SIGNAL_IDS),
    ...(options.extraSignalIds ?? []),
  ];

  const channels = new Map<string, PlaybackChannel>();
  for (const signalId of wanted) {
    if (!channels.has(signalId)) {
      channels.set(signalId, sampleAt(source.dataset, signalId, tSeconds, maxGapSeconds));
    }
  }

  const latitude = channels.get(POSITION_SIGNAL_IDS.latitude);
  const longitude = channels.get(POSITION_SIGNAL_IDS.longitude);
  const altitude = channels.get(POSITION_SIGNAL_IDS.altitude);

  const position: PlaybackPosition | null =
    usable(latitude) && usable(longitude)
      ? {
          latitudeRad: latitude?.value ?? NaN,
          longitudeRad: longitude?.value ?? NaN,
          altitudeMeters: usable(altitude) ? (altitude?.value ?? null) : null,
        }
      : null;

  const roll = channels.get(ATTITUDE_SIGNAL_IDS.roll);
  const pitch = channels.get(ATTITUDE_SIGNAL_IDS.pitch);
  const yaw = channels.get(ATTITUDE_SIGNAL_IDS.yaw);

  const attitude: PlaybackAttitude | null =
    usable(roll) && usable(pitch) && usable(yaw)
      ? {
          rollRad: roll?.value ?? NaN,
          pitchRad: pitch?.value ?? NaN,
          yawRad: yaw?.value ?? NaN,
        }
      : null;

  return { tSeconds, channels, position, attitude };
}
