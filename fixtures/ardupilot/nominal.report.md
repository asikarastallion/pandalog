# Flight analysis — nominal.bin

Generated `2026-01-01T00:00:00.000Z`. This timestamp is the only part of a report that changes between two runs over the same inputs and versions.

## Source

| Field | Value |
| --- | --- |
| File | `nominal.bin` |
| SHA-256 | `e3a1bbfbd99f4e7b7186062bdf752fd9ee9307a5daa8cd1f3c30bc75ae476e23` |
| Size | 1660 bytes |
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
| `analysis:vibration-level` | `1.0.0` | no |

A rule that applied and found nothing is not the same as a rule that did not apply; both are listed so the report says what the flight was actually checked against.

## Summary

Findings: 0 (CRITICAL 0, WARNING 0, ADVISORY 0, INFO 0)

Verification against `pandalog-provisional` version `1.0.0`, source `provisional`: PASS 3, FAIL 0, INCONCLUSIVE 0, NOT_APPLICABLE 1.

## Findings

This flight raised no findings. That is not a statement that nothing was wrong — it means no registered rule found a condition it was written to detect.

## Verification

### `REQ-ATT-001` — PASS

analysis:attitude-tracking-error raised no finding over the 4 signal window(s) examined (t=[0.000, 1.900]). The criterion is provisional and is not traceable to a flight-test document, so this PASS means the flight met a provisional criterion, not a qualified one.

Requirement version `1.0.0`.

Evidence:

- signal `attitude.roll`, t = 0 s to 1.9 s
- signal `attitude.roll.desired`, t = 0 s to 1.9 s
- signal `attitude.pitch`, t = 0 s to 1.9 s
- signal `attitude.pitch.desired`, t = 0 s to 1.9 s

### `REQ-ERR-001` — PASS

1 discrete log record(s) were examined over t=[0.000, 0.000] and none was an error. This assumes the firmware's error logging was enabled; the canonical dataset carries no logging-bitmask field, so PandaLog cannot confirm it.

Requirement version `1.0.0`.

Evidence:

- event `events:mode-change:mode-change@0.000000#0`

### `REQ-GNSS-001` — PASS

analysis:gps-availability raised no finding over the 1 signal window(s) examined (t=[0.000, 1.800]). The criterion is provisional and is not traceable to a flight-test document, so this PASS means the flight met a provisional criterion, not a qualified one.

Requirement version `1.0.0`.

Evidence:

- signal `gps.fix_type`, t = 0 s to 1.8 s

### `REQ-VIB-001` — NOT_APPLICABLE

Outside this flight's applicable envelope, so no PASS or FAIL is claimed. Applies to any flight logging all three vibration axes. A partial axis set is not enough to judge airframe vibration and produces NOT_APPLICABLE.

Requirement version `1.0.0`.
