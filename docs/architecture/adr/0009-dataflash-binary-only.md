# ADR-0009 — Phase B decodes binary `.BIN` only; text `.log` is out of scope

- **Status:** Accepted
- **Date:** 2026-08-16
- **Affects:** `05_IMPLEMENTATION_ROADMAP.md` Phase B, `docs/architecture/dependency-layers.json`
  (`@pandalog/parser-ardupilot` responsibility)

## Context

Phase B's deliverables include:

> Legacy text `.log` support if still in scope (confirm against real-world prevalence before
> building; ADR if scope is narrowed).

That instruction requires a decision backed by evidence rather than a default.

ArduPilot's own documentation is unambiguous: `.BIN` is what the autopilot writes. The format is
self-describing — a set of `FMT` messages at the head of the file declares the layout of every
message that follows, so a reader needs no out-of-band schema. The `.log` extension refers to a
text rendering produced _after_ download, by a ground station or conversion tool, for readability.

## Decision

`@pandalog/parser-ardupilot` decodes binary DataFlash (`.BIN`) only. Text `.log` is out of scope
for Phase B and is not partially implemented.

The manifest responsibility for the package is amended from "(.bin/.log)" to "(.BIN)" so it does
not advertise a capability that does not exist.

## Reason

- **`.BIN` is the source artifact; `.log` is derived from it.** Supporting the derived form buys no
  data that the primary form lacks, and every field in a `.log` traces back to a `.BIN` record.
- **`.BIN` is self-describing, `.log` is not.** The `FMT` table gives exact types, widths and
  scaling per field. A text rendering has already discarded that: numbers arrive pre-formatted, at
  the precision the converter chose, with the type erased. Doc 02's invariants — explicit units,
  explicit validity, no silent coercion — are materially harder to honour from a lossy text
  rendering, and any parser doing so would be inferring what the binary states outright.
- **It would not be free.** A text reader is a second decoding path with its own truncation,
  encoding and locale edge cases, and its own fixtures, for a format users can regenerate from the
  file we already read.

## Consequences

- A user holding only a `.log` cannot ingest it today. The remedy is to supply the `.BIN`, which is
  the file the autopilot produced.
- If `.log` support is ever warranted, it arrives as a separate adapter — `parser-ardupilot-text`
  or similar — registered alongside this one. It does not become a second code path inside the
  DataFlash decoder. This is exactly the extension shape ADR-0005 designed the adapter contract
  for: a new source format is a new adapter.
- `canParse` must therefore reject text input positively rather than attempting a best-effort
  decode, so a `.log` produces `NO_ADAPTER` — a clear "this format is not supported" — instead of
  a confusing parse failure.

## Alternatives rejected

- **Implement both now.** Doubles the Phase B surface, and the second half is a lossy view of the
  first. Doc 05 explicitly warns against building ahead of the current phase.
- **Accept `.log` with a best-effort decoder.** Produces a dataset whose units and validity are
  inferred from formatting rather than declared. That is precisely the class of quiet inference
  the canonical model exists to prevent.

## Sources

- [Logs — Copter documentation](https://ardupilot.org/copter/docs/common-logs.html)
- [Downloading and Analyzing Data Logs in Mission Planner](https://ardupilot.org/copter/docs/common-downloading-and-analyzing-data-logs-in-mission-planner.html)
- [Dataflash .bin versus .log files — ArduPilot Discourse](https://discuss.ardupilot.org/t/dataflash-bin-versus-log-files/60226)
