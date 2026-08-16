# ArduPilot fixtures

| File                    | Exercises                                                                    |
| ----------------------- | ---------------------------------------------------------------------------- |
| `nominal.bin`           | Attitude, barometer and GPS over 2 s, with one mode change                   |
| `gps-glitch.bin`        | A GPS fix loss with NaN speed samples, plus `VIBE` declared but never logged |
| `mode-change-error.bin` | In-flight mode changes, a logged error, and a text message                   |

Each `.bin` is paired with four goldens, one per pipeline stage, all compared on every test run:

| Golden                     | Stage                | A diff here means                                      |
| -------------------------- | -------------------- | ------------------------------------------------------ |
| `<name>.expected.json`     | canonical dataset    | decoding, unit conversion, signal naming or validity   |
| `<name>.events.json`       | detected events      | a detector's logic or threshold                        |
| `<name>.verification.json` | requirement outcomes | an analysis criterion or a requirement's applicability |
| `<name>.cli.json`          | full CLI document    | the wiring between stages, or the CLI's own envelope   |

The verification golden runs ingest → detect → analyse → verify, so a change anywhere beneath it
moves a PASS, FAIL, INCONCLUSIVE or NOT_APPLICABLE. The CLI golden is what a user in CI actually
receives — the same pipeline plus provenance, counts and the exit code — so a stage that stops being
wired to the next shows up there even when each stage still passes its own golden.

Two of its current outcomes are worth reading rather than skimming, because both are honest results
rather than bugs:

- `gps-glitch` **passes** `REQ-GNSS-001`. The fixture's fix loss lasts 0.4 s and the provisional
  tolerance is 2 s. Lowering the tolerance until this fixture failed would be fitting a threshold to
  the data at hand — exactly what doc 03 §4 forbids.
- `gps-glitch` is **inconclusive** on `REQ-VIB-001`. The log declares the `VIBE` message but never
  writes a sample, so all three axes exist with `UNSUPPORTED` validity. Nothing was examined, so
  nothing is verified — which is the distinction the whole package is built around.

## These logs are synthetic

They were produced by [`scripts/generate-fixtures.mjs`](../../scripts/generate-fixtures.mjs), not
recorded from an aircraft. That script is committed so the fixtures are reproducible rather than
opaque blobs, and it can be re-run with:

```bash
node scripts/generate-fixtures.mjs
```

**What this does and does not prove.** The generator and the decoder in
`packages/parser-ardupilot` were written from the same understanding of the DataFlash format. A
golden test built only on them therefore demonstrates that the pipeline is internally consistent
and stable over time — it does **not** demonstrate that the decoder reads real ArduPilot output
correctly. If that shared understanding is wrong in some detail, these fixtures agree with it.

What independently pins the decoder is
[`packages/parser-ardupilot/test/format.test.ts`](../../packages/parser-ardupilot/test/format.test.ts):
every format character is checked against byte sequences computed outside this codebase, so widths,
signedness, endianness and scale factors are verified against the format specification rather than
against our own encoder.

**Outstanding:** validation against a real ArduPilot `.BIN` from a physical vehicle. Dropping one
into this directory and adding it to the golden set would turn "internally consistent" into
"correct". Until then, treat the ArduPilot parser as unproven on real hardware output.
