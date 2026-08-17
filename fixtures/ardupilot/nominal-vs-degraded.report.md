# Flight analysis — degraded-flight.bin

Generated `2026-01-01T00:00:00.000Z`. This timestamp is the only part of a report that changes between two runs over the same inputs and versions.

## Source

| Field | Value |
| --- | --- |
| File | `degraded-flight.bin` |
| SHA-256 | `46a28608fc6538325c5a96ddee188607964b1eb31775c01df222c2ff0d08c242` |
| Size | 5854 bytes |
| Format | `ardupilot-dataflash` |
| Parser | `@pandalog/parser-ardupilot` `0.1.0` |
| Ingested | `2026-01-01T00:00:00.000Z` |
| Canonical model | `1.0.0` |
| Reporting | `0.1.0` |
| Frame class | not logged |
| Firmware | not logged |
| Firmware hash | not logged |

## Rules applied

| Rule | Version | Applied to this flight |
| --- | --- | --- |
| `analysis:attitude-tracking-error` | `1.0.0` | yes |
| `analysis:gps-availability` | `1.0.0` | yes |
| `analysis:vibration-level` | `1.0.0` | yes |

A rule that applied and found nothing is not the same as a rule that did not apply; both are listed so the report says what the flight was actually checked against.

## Summary

Findings: 3 (CRITICAL 0, WARNING 3, ADVISORY 0, INFO 0)

Verification against `pandalog-provisional` version `1.0.0`, source `provisional`: PASS 1, FAIL 3, INCONCLUSIVE 0, NOT_APPLICABLE 0.

## Findings

### `analysis:attitude-tracking-error` — WARNING

Roll tracking exceeded the configured criterion (peak RMS error 0.1745 rad against a 0.0873 rad criterion) for 4.90 s. The criterion is provisional and is not traceable to a flight-test requirement.

Measurements:

- Peak RMS tracking error: 0.174533 rad
- Exceedance duration: 4.9 s

Thresholds:

- RMS tracking error criterion: 0.0873 rad (basis `provisional`)
- RMS window: 2 s (basis `provisional`)
- Minimum exceedance duration: 1 s (basis `provisional`)
- Analysis resample rate: 10 unitless (basis `provisional`)
- Maximum interpolation gap: 0.5 s (basis `provisional`)

Evidence:

- signal `attitude.roll`, t = 2.5 s to 7.4 s
- signal `attitude.roll.desired`, t = 2.5 s to 7.4 s
- measurement on `attitude.roll.error.rms` at 7.4 s: 0.174533 rad

Rule `analysis:attitude-tracking-error` version `1.0.0`.

### `analysis:gps-availability` — WARNING

GPS fix was lost for 2.80 s, exceeding the tolerated maximum of 2 s. The tolerance is provisional and is not traceable to a flight-test requirement.

Measurements:

- Fix loss duration: 2.8 s

Thresholds:

- Maximum tolerated GPS fix loss: 2 s (basis `provisional`)

Evidence:

- event `events:gps-fix-loss:gps-fix-loss@3.000000#0`
- signal `gps.fix_type`, t = 3 s to 5.8 s
- measurement on `gps.fix_type` at 3 s: 1 unitless

Rule `analysis:gps-availability` version `1.0.0`.

### `analysis:vibration-level` — WARNING

Vibration magnitude peaked at 43.30 m/s^2 against a 30 m/s^2 criterion, sustained for 1.90 s. The criterion is provisional and airframe-independent.

Measurements:

- Peak vibration magnitude: 43.3013 m/s^2
- Excursion duration: 1.9 s

Thresholds:

- Peak vibration criterion: 30 m/s^2 (basis `provisional`)
- Minimum reportable excursion: 1 s (basis `provisional`)

Evidence:

- event `events:vibration-excursion:vibration-excursion@1.000000#0`
- signal `vibration.x`, t = 1 s to 2.9 s
- signal `vibration.y`, t = 1 s to 2.9 s
- signal `vibration.z`, t = 1 s to 2.9 s
- measurement on `vibration.magnitude` at 1 s: 43.3013 m/s^2

Rule `analysis:vibration-level` version `1.0.0`.

## Verification

### `REQ-ATT-001` — FAIL

1 finding(s) from analysis:attitude-tracking-error exceeded its criterion over t=[0.000, 7.900]. The criterion is provisional and is not traceable to a flight-test document, so this FAIL states that a provisional criterion was exceeded — not that the aircraft breached a qualified limit.

Requirement version `1.0.0`.

Evidence:

- signal `attitude.roll`, t = 0 s to 7.9 s
- signal `attitude.roll.desired`, t = 0 s to 7.9 s
- signal `attitude.pitch`, t = 0 s to 7.9 s
- signal `attitude.pitch.desired`, t = 0 s to 7.9 s
- signal `attitude.roll`, t = 2.5 s to 7.4 s
- signal `attitude.roll.desired`, t = 2.5 s to 7.4 s
- measurement on `attitude.roll.error.rms` at 7.4 s: 0.174533 rad

### `REQ-ERR-001` — PASS

2 discrete log record(s) were examined over t=[0.000, 0.000] and none was an error. This assumes the firmware's error logging was enabled; the canonical dataset carries no logging-bitmask field, so PandaLog cannot confirm it.

Requirement version `1.0.0`.

Evidence:

- event `events:logged-message:logged-message@0.000000#0`
- event `events:mode-change:mode-change@0.000000#0`

### `REQ-GNSS-001` — FAIL

1 finding(s) from analysis:gps-availability exceeded its criterion over t=[0.000, 7.800]. The criterion is provisional and is not traceable to a flight-test document, so this FAIL states that a provisional criterion was exceeded — not that the aircraft breached a qualified limit.

Requirement version `1.0.0`.

Evidence:

- signal `gps.fix_type`, t = 0 s to 7.8 s
- event `events:gps-fix-loss:gps-fix-loss@3.000000#0`
- signal `gps.fix_type`, t = 3 s to 5.8 s
- measurement on `gps.fix_type` at 3 s: 1 unitless

### `REQ-VIB-001` — FAIL

1 finding(s) from analysis:vibration-level exceeded its criterion over t=[0.000, 7.900]. The criterion is provisional and is not traceable to a flight-test document, so this FAIL states that a provisional criterion was exceeded — not that the aircraft breached a qualified limit.

Requirement version `1.0.0`.

Evidence:

- signal `vibration.x`, t = 0 s to 7.9 s
- signal `vibration.y`, t = 0 s to 7.9 s
- signal `vibration.z`, t = 0 s to 7.9 s
- event `events:vibration-excursion:vibration-excursion@1.000000#0`
- signal `vibration.x`, t = 1 s to 2.9 s
- signal `vibration.y`, t = 1 s to 2.9 s
- signal `vibration.z`, t = 1 s to 2.9 s
- measurement on `vibration.magnitude` at 1 s: 43.3013 m/s^2

## Comparison

Baseline `nominal.bin` against subject `degraded-flight.bin`.

Overall: DIFFERENT

| Axis | Verdict | Basis |
| --- | --- | --- |
| Signals | DIFFERENT | 14 signal(s) in both flights: 14 compared point by point, 0 by distribution only, 0 not comparable. 14 signal(s) actually contributed to the verdict. 3 only in the baseline, 3 only in the subject. |
| Events | DIFFERENT | 1 event(s) matched within 1 s, 0 only in the baseline and 3 only in the subject. |
| Findings | DIFFERENT | 3 rule occurrence(s) compared: 3 new, 0 resolved, 0 changed severity. A measurement that moved without changing severity is reported but is not, by itself, a material difference — severity is the rule's own judgement (doc 03 §4). |
| Verification | DIFFERENT | 4 requirement(s) compared against set pandalog-provisional@1.0.0: 2 regressed, 0 improved, 1 changed applicability, 0 added, 0 removed. |

Time alignment: Both flights measure elapsed time from BOOT, so t is the same quantity in each. This is an alignment of elapsed time, not of clocks: two flights at the same elapsed second are not necessarily at the same point in their missions, so a difference at t may be a difference in phase as much as in behaviour. Neither flight states its offset from UTC, which this comparison does not need but which means a sub-second difference cannot be separated from clock error.

- Requirements that regressed: `REQ-ATT-001`, `REQ-GNSS-001`
- Requirements that improved: none
