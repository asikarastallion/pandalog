# ADR-0016 — Reports carry the flight's events, and mode intervals name their unlogged boundaries

- **Status:** Accepted
- **Date:** 2026-08-18
- **Affects:** `docs/architecture/dependency-layers.json` (`@pandalog/reporting` gains
  `@pandalog/events`), `packages/reporting` (`ReportInput`/`ReportDocument`), `packages/events`
  (new `segments.ts`), `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §7

## Context

Two questions a reader asks of a flight report, and neither could be answered:

1. **"What mode was it in when this happened?"** The report renders findings, hypotheses and
   verification results. It renders no events at all. A `Finding` cites a time window; the mode the
   aircraft was flying in over that window is in the dataset, in the pipeline result, and nowhere in
   the document.
2. **"What did the signal actually do?"** The report is prose and tables. A comparable tool puts an
   altitude profile, an attitude trace and a battery curve on the page, and an engineer reads the
   shape of a curve faster than a paragraph describing it.

Both need the same thing: the flight's events, inside `@pandalog/reporting`. Charts want mode
changes as background bands; a mode log wants them as a table.

`@pandalog/reporting`'s `allowedDependencies` did not include `@pandalog/events`, and
`dependency-direction.test.ts` scans **all** import specifiers, type-only included, so this is a
manifest change rather than an implementation detail.

## Decision

### 1. `@pandalog/reporting` may depend on `@pandalog/events`

`ReportInput` gains `events`, and `ReportDocument` carries them. The dependency direction is
unchanged — events is layer 5, reporting is layer 10 — and reporting already reaches events
transitively through `@pandalog/analysis`. What changes is that the edge is now declared and used
directly.

This does not widen what reporting may _do_. Doc 04 §7 still holds: reporting renders and computes
nothing, and events are one more artifact it embeds verbatim rather than a new source of numbers it
may derive from.

### 2. Mode intervals are derived in `@pandalog/events`, not in each consumer

A log records mode changes as instants (`MODE` records). Every consumer that wants to colour a
track, band a chart or list a mode log needs the same thing: the _interval_ each mode was active
over. Three consumers deriving that separately is three chances to disagree about where a mode
ended, so it is derived once, in the package that owns events.

### 3. An interval's unlogged boundaries are named, never assumed

This is the part that constrains the design, and it follows a precedent already in this package.
`ARM_DISARM_DETECTOR` deliberately refuses to pair arm and disarm into an armed _interval_:

> a log can begin or end mid-flight: pairing them into an interval would require inventing a
> boundary the log does not contain.

Mode intervals have exactly that problem at both ends:

- **Before the first `MODE` record**, the aircraft was in _some_ mode and the log does not say
  which. That period is represented with a `null` mode, not back-filled from the first record.
- **After the last `MODE` record**, the mode continued until the log stopped. That segment's end is
  the end of data, which is not a logged transition.

So a segment carries `startsAtLoggedChange` and `endsAtLoggedChange`, and a renderer showing an
unlogged boundary as a hard edge is showing something the log did not record.

### 4. A mode is a number until the vehicle says otherwise

The payload carries `Mode: 5`. ArduCopter mode 5 is LOITER; ArduPlane mode 5 is FBWA. The catalogue
that resolves one to the other is vehicle-type-specific, and `Vehicle.frameClass` is `null` in every
fixture this repository has — ArduPilot does not always log it.

Naming a mode from a number without knowing the vehicle is exactly the "unexamined assumption
(vehicle type, firmware, mode) baked into a threshold" that doc 04 §13 asks about, one layer up. So
the segment carries the number, and a name only when the frame class is known **and** the table
covers it. Otherwise it displays as `Mode 5`, which is what the log actually said.

## Alternatives rejected

**Pass mode bands into reporting as pre-extracted data.** Avoids the manifest edge, at the cost of
every caller — the app, the CLI — extracting them separately. That is the duplication decision 2
exists to prevent, and it would also leave the report unable to carry a mode log at all.

**Derive intervals in `@pandalog/reporting`.** The app needs identical intervals for the 2D track,
the 3D playback and the timeline, and the app does not go through reporting for those views. It
would have been reporting's rule with three other implementations of it.

**Assume the mode before the first record.** Back-filling from the first `MODE` record would produce
a track coloured with a mode the log never asserted for that stretch, which is doc 04 §1 rule 6
performed in colour instead of in numbers.

**Ship a mode-number table anyway, keyed on "probably a copter".** Most ArduPilot logs in this
domain are multirotors, so it would be right most of the time and silently wrong the rest — a
failure mode indistinguishable from correctness for the reader.

---

## Amendment, same date — `apps/web` may depend on `@pandalog/comparison`

Doc 05 Phase J delivered `@pandalog/comparison` complete and well tested (97% statement coverage,
seven injected defects caught). It was reachable from nowhere. It appeared in neither `apps/web`'s
`allowedDependencies` nor the CLI's, and `dependency-layers.json` described `apps/web` as providing
a "comparison" view that did not exist.

That is not a missing feature so much as an inconsistency between the manifest and the code, and
doc 04 §11 says code-says-A/docs-say-B is not an acceptable interim state. `apps/web` gains
`@pandalog/comparison`.

The dependency direction is unchanged — comparison is layer 9, `apps/web` is layer 11 — and
`apps/web` already reached the package's _types_ transitively through `@pandalog/reporting`, which
embeds a `ComparisonReport`. What changes is that the app may now call `compareFlights`.

**No new capability is introduced by the view.** `compareFlights` is the same deterministic function
the CLI would call and the tests already exercise; the view selects two analysed logs and renders
its output, including `INCOMPARABLE`, which ADR-0012 makes a first-class answer for exactly the
reason `INCONCLUSIVE` is one in verification. A comparison view that showed `INCOMPARABLE` as "no
difference" would undo that decision in the one place a user actually reads it.

**Comparison runs over two logs the browser has already stored.** Both flights are re-run through
the pipeline from their stored bytes, the way reopening a single log already works, rather than
caching a `ComparisonReport` — doc 03 §6 guarantees the re-run is byte-identical, and it keeps the
comparison a statement about what the code currently concludes rather than about what some earlier
version concluded.
