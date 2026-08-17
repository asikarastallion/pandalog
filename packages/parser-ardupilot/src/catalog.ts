/**
 * ArduPilot message/field -> canonical signal catalog.
 *
 * The FMT table tells us a field's *width and scaling*; it does not tell us what the number means
 * or what unit it is in. That mapping is engineering knowledge about ArduPilot, and it lives here,
 * declared explicitly, rather than being inferred from field names at runtime.
 *
 * `sourceUnit` is the unit of the value **after** the format character's scaling has been applied
 * (doc: `format.ts`). ATT.Roll is stored as `c` — int16 hundredths of a degree — so by the time it
 * reaches this table it is degrees, and `sourceUnit` is `deg`. `@pandalog/core-domain` converts
 * from there to the canonical unit; this package never applies a unit conversion itself
 * (doc 04 §1 rule 7).
 *
 * Fields absent from this catalog are not emitted as signals. That is deliberate: doc 02 §3
 * invariant 2 forbids a numeric signal without a real unit, and inventing `unitless` for a field
 * whose meaning we have not established would be exactly the silent guess the model exists to
 * prevent. Unmapped fields are reported by `unmappedFields` so nothing disappears unnoticed.
 */
import type { SourceUnit } from '@pandalog/schema';

export interface SignalMapping {
  /** Canonical signal id, e.g. "attitude.roll". */
  readonly id: string;
  /** Unit of the value after format-character scaling; must be known to core-domain's table. */
  readonly sourceUnit: SourceUnit;
}

/** message name -> field label -> canonical mapping. */
export const SIGNAL_CATALOG: Readonly<Record<string, Readonly<Record<string, SignalMapping>>>> =
  Object.freeze({
    ATT: Object.freeze({
      Roll: { id: 'attitude.roll', sourceUnit: 'deg' },
      Pitch: { id: 'attitude.pitch', sourceUnit: 'deg' },
      Yaw: { id: 'attitude.yaw', sourceUnit: 'deg' },
      DesRoll: { id: 'attitude.roll.desired', sourceUnit: 'deg' },
      DesPitch: { id: 'attitude.pitch.desired', sourceUnit: 'deg' },
      DesYaw: { id: 'attitude.yaw.desired', sourceUnit: 'deg' },
      ErrRP: { id: 'attitude.error.rollpitch', sourceUnit: 'deg' },
      ErrYaw: { id: 'attitude.error.yaw', sourceUnit: 'deg' },
    }),

    IMU: Object.freeze({
      GyrX: { id: 'imu.gyro.x', sourceUnit: 'rad/s' },
      GyrY: { id: 'imu.gyro.y', sourceUnit: 'rad/s' },
      GyrZ: { id: 'imu.gyro.z', sourceUnit: 'rad/s' },
      AccX: { id: 'imu.accel.x', sourceUnit: 'm/s^2' },
      AccY: { id: 'imu.accel.y', sourceUnit: 'm/s^2' },
      AccZ: { id: 'imu.accel.z', sourceUnit: 'm/s^2' },
    }),

    BARO: Object.freeze({
      Alt: { id: 'baro.altitude', sourceUnit: 'm' },
      Press: { id: 'baro.pressure', sourceUnit: 'Pa' },
      Temp: { id: 'baro.temperature', sourceUnit: 'degC' },
    }),

    GPS: Object.freeze({
      Lat: { id: 'gps.latitude', sourceUnit: 'deg' },
      Lng: { id: 'gps.longitude', sourceUnit: 'deg' },
      Alt: { id: 'gps.altitude', sourceUnit: 'm' },
      Spd: { id: 'gps.ground_speed', sourceUnit: 'm/s' },
      VZ: { id: 'gps.velocity.down', sourceUnit: 'm/s' },
      NSats: { id: 'gps.satellites', sourceUnit: 'count' },
      HDop: { id: 'gps.hdop', sourceUnit: 'unitless' },
      Status: { id: 'gps.fix_type', sourceUnit: 'unitless' },
    }),

    BAT: Object.freeze({
      Volt: { id: 'battery.voltage', sourceUnit: 'V' },
      Curr: { id: 'battery.current', sourceUnit: 'A' },
      Temp: { id: 'battery.temperature', sourceUnit: 'degC' },
    }),

    VIBE: Object.freeze({
      VibeX: { id: 'vibration.x', sourceUnit: 'm/s^2' },
      VibeY: { id: 'vibration.y', sourceUnit: 'm/s^2' },
      VibeZ: { id: 'vibration.z', sourceUnit: 'm/s^2' },
    }),

    // Servo/motor outputs are PWM pulse widths in microseconds — a duration, so canonically seconds.
    RCOU: Object.freeze({
      C1: { id: 'servo.output.1', sourceUnit: 'us' },
      C2: { id: 'servo.output.2', sourceUnit: 'us' },
      C3: { id: 'servo.output.3', sourceUnit: 'us' },
      C4: { id: 'servo.output.4', sourceUnit: 'us' },
    }),
  });

/** Field name carrying the microsecond boot timestamp on every timestamped message. */
export const TIME_FIELD = 'TimeUS';

/**
 * Messages turned into `sourceEvents` rather than signals: they are discrete occurrences carried
 * by the log itself, which is exactly what `CanonicalFlightDataset.sourceEvents` is for (doc 02 §2).
 */
/**
 * A field whose value only means anything when another field in the same record says so.
 *
 * ArduPilot writes `Lat`/`Lng`/`Alt` as literal zeros when the receiver has no fix. Those are not
 * measurements — they are the absence of one, written as a number. Passing them through as `VALID`
 * would put the aircraft at 0°N 0°E and let every consumer downstream believe it, which is doc 04
 * §1 rule 6 violated by the log rather than by us. This package is the only layer that sees both
 * the coordinate and the status that invalidates it, so it is where the two are reconciled.
 */
export interface RecordPrecondition {
  /** Field in the same record that decides whether the gated fields mean anything. */
  readonly gateLabel: string;
  /** The gated fields are measurements only when the gate reads at least this. */
  readonly minimum: number;
  readonly gatedLabels: readonly string[];
  /** Where the threshold comes from — same discipline as an analysis threshold (doc 03 §4). */
  readonly basis: string;
  readonly reason: string;
}

/**
 * ArduPilot `GPS.Status`: 0 = no GPS, 1 = no fix, 2 = 2D fix, 3 = 3D fix, and higher values are
 * 3D fixes with augmentation. Below 3 there is no usable position solution, so a latitude and
 * longitude cannot be a reading of where the aircraft was.
 *
 * Altitude is gated with them: it comes from the same solution, and a 2D fix does not produce one.
 */
export const RECORD_PRECONDITIONS: Readonly<Record<string, RecordPrecondition>> = Object.freeze({
  GPS: Object.freeze({
    gateLabel: 'Status',
    minimum: 3,
    gatedLabels: Object.freeze(['Lat', 'Lng', 'Alt']),
    basis: 'spec:ardupilot-gps-status',
    reason: 'the receiver reported no 3D fix, so the logged position is a placeholder zero',
  }),
});

export const SOURCE_EVENT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  MODE: 'mode-change',
  ERR: 'error',
  MSG: 'message',
  EV: 'event',
});

export function lookupSignal(messageName: string, fieldLabel: string): SignalMapping | null {
  return SIGNAL_CATALOG[messageName]?.[fieldLabel] ?? null;
}
