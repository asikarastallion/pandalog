# PandaLog

**Professional Flight Data Analysis & Verification Platform.**

Not a flight log visualiser. PandaLog ingests flight data, normalises it into one canonical
model, derives engineering signals, detects events, produces evidence-backed findings, verifies
requirements, and generates reproducible reports.

```text
Flight Log → Ingestion → Canonical Flight Data → Derived Signals → Events
          → Deterministic Analysis → Evidence-backed Findings → Investigation
          → Requirement Verification → Comparison → Reports → (optional) AI
```

ArduPilot is the first supported ecosystem; the core is format-agnostic by construction — a new
source format is a new adapter, never a rewrite of the analysis engine.

**No backend.** PandaLog ships as a static, client-side web application (`apps/web`) plus a
Node CLI (`@pandalog/cli`) for headless/CI use. Flight logs are parsed and analysed entirely on
the user's machine; nothing is uploaded by default. See
[`01_SYSTEM_ARCHITECTURE.md`](01_SYSTEM_ARCHITECTURE.md) §2 for the deployment topology and why
every core package is built to run identically in a browser Worker or under Node.

## Try it

**<https://asikarastallion.github.io/pandalog/>** — no install, no sign-in, no upload.

The page runs the entire pipeline in your browser tab: it decodes the log, derives signals, detects
events, applies the analysis rules and verifies the requirement set, then lets you open any finding
down to the samples behind it. There is no server involved, so the log never leaves your machine —
that is not a policy, it is that [there is nowhere to send it](#why-github-pages).

### Sample logs

Download any of these from GitHub — the link starts the download directly, no `git clone` — then
drag it onto the page. Each one exercises a different outcome.

| Log                                                                                                                              | What it shows                                                                                                                                                                                                                                   | Verification                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`nominal.bin`](https://github.com/asikarastallion/pandalog/raw/main/fixtures/ardupilot/nominal.bin) (1.7 KB)                    | A clean flight. No rule fires.                                                                                                                                                                                                                  | 3 PASS, 1 NOT_APPLICABLE         |
| [`degraded-flight.bin`](https://github.com/asikarastallion/pandalog/raw/main/fixtures/ardupilot/degraded-flight.bin) (5.8 KB)    | The interesting one: a roll-tracking excursion, a GNSS outage and a vibration excursion. 3 findings, a ground track that **breaks** where the fix was lost, and playback that has no position during the outage rather than gliding through it. | 1 PASS, 3 FAIL                   |
| [`gps-glitch.bin`](https://github.com/asikarastallion/pandalog/raw/main/fixtures/ardupilot/gps-glitch.bin) (907 B)               | Requirements that cannot be judged from the data. Shows `INCONCLUSIVE` as its own outcome rather than folded into a pass or a fail.                                                                                                             | 2 PASS, 2 INCONCLUSIVE           |
| [`mode-change-error.bin`](https://github.com/asikarastallion/pandalog/raw/main/fixtures/ardupilot/mode-change-error.bin) (762 B) | Mode changes and a logged error, read from the log's own records rather than derived.                                                                                                                                                           | 1 PASS, 1 FAIL, 2 NOT_APPLICABLE |

Every threshold behind those outcomes is `provisional` and says so on screen — see the caveat in
[Status](#status).

### Trying a file that is not a log

Worth doing, because how a tool fails is part of what it is. Drop a photo, an empty file, a text
file renamed `.BIN`, or a log truncated mid-download. Each gives three things: what the analysis
said verbatim, what it means for you, and the fact that nothing was partially accepted — a
malformed log is never half-parsed and presented as a whole flight. The workspace stays usable;
drop a real log straight afterwards and it opens normally.

## Status

Roadmap runs A → L (`05_IMPLEMENTATION_ROADMAP.md`). **A through L are complete** — the pipeline
runs end to end, from a dropped `.BIN` to a provenance-stamped report, with an opt-in explanatory
layer on top that cannot overrule any of it.

`pnpm verify` is green, and the boundaries are enforced rather than agreed: the architecture test
fails the build on an upward dependency, an undeclared import, or a `node:` import inside a package
that must stay platform neutral.

A `.BIN` log now runs the whole deterministic pipeline: ingested into the canonical model, queried
and resampled, detected into events, analysed into evidence-backed findings, and verified against a
requirement set — with the outcome of all four stages committed as golden fixtures. Note the caveat
in [`fixtures/ardupilot/README.md`](fixtures/ardupilot/README.md): those fixtures are synthetic, so
the parser is proven internally consistent but not yet validated against a real vehicle's log.

Two front ends run that pipeline: `pandalog verify` headless with a CI-usable exit code (see
[Verifying a log](#verifying-a-log)), and `apps/web`, a static browser workspace for investigating a
finding down to the signals behind it (see [Investigating a flight](#investigating-a-flight)). They
share one composition — `@pandalog/pipeline` — so a CI run and the same log opened in a browser
cannot disagree about what happened.

One limit is worth stating plainly rather than discovering later: **every threshold and every
requirement currently in the repository is `provisional`.** Nothing here traces to a flight-test
document, so a PASS means a placeholder criterion was met — and each finding, each result and the
CLI's own stderr summary says so rather than leaving it to be inferred.

| Package                                                   | Layer | Responsibility                                                                 | Phase |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ | ----- |
| [`@pandalog/schema`](packages/schema)                     | 0     | The canonical flight data model. Zero dependencies.                            | A ✅  |
| [`@pandalog/core-domain`](packages/core-domain)           | 1     | Unit conversion, time normalisation, signal and dataset construction.          | A ✅  |
| [`@pandalog/ingestion`](packages/ingestion)               | 2     | Parser adapter contract, registry, canonicalization bridge.                    | A ✅  |
| [`@pandalog/parser-ardupilot`](packages/parser-ardupilot) | 3     | ArduPilot DataFlash `.BIN` decoding.                                           | B ✅  |
| [`@pandalog/query`](packages/query)                       | 4     | Signal query, resampling, derived-signal registry.                             | C ✅  |
| [`@pandalog/events`](packages/events)                     | 5     | Flight event detection.                                                        | D ✅  |
| [`@pandalog/analysis`](packages/analysis)                 | 6     | Deterministic rules → evidence-backed findings.                                | E ✅  |
| [`@pandalog/verification`](packages/verification)         | 7     | Requirement definitions and evaluation.                                        | F ✅  |
| [`@pandalog/pipeline`](packages/pipeline)                 | 8     | Ingest → detect → analyse → verify, composed once for every app.               | H ✅  |
| [`@pandalog/comparison`](packages/comparison)             | 9     | Flight-vs-flight / flight-vs-baseline comparison.                              | J ✅  |
| [`@pandalog/reporting`](packages/reporting)               | 10    | Reproducible report rendering (no calculation).                                | K ✅  |
| [`@pandalog/ai`](packages/ai)                             | 10    | Optional explanatory layer over evidence. Removable without breaking the rest. | L ✅  |
| [`@pandalog/cli`](packages/cli)                           | 11    | Headless ingest → analyze → verify → report.                                   | G ✅  |
| [`apps/web`](apps/web)                                    | 11    | Vue investigation workspace.                                                   | H ✅  |

Layer number orders dependencies, not build order: `cli` and `web` arrive in phases G and H but
sit at the top because they consume everything beneath them (ADR-0008).

**This table is keyed by package, not by phase.** A phase that extends an application rather than
adding a package — Phase I, which built the map, playback and 3D views into `apps/web` — has no row
of its own. Absence here does not mean a phase was skipped; `05_IMPLEMENTATION_ROADMAP.md` is the
record of what each phase delivered (ADR-0015).

Every package's permitted dependencies are declared in
[`docs/architecture/dependency-layers.json`](docs/architecture/dependency-layers.json) and
checked by a test, not left to convention (see [Enforcement](#enforcement)).

## Continuous integration

Every push and pull request runs [the CI workflow](.github/workflows/ci.yml); the result is on the
commit and in the repository's **Actions** tab. Three checks, deliberately named for what they
answer:

| Check                                     | Question it answers                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture boundaries**               | Is this still the shape of system the documents describe? Package layering, the UI boundary, and that nothing depends on `@pandalog/ai`. |
| **Verify (typecheck, lint, test, build)** | `pnpm verify` plus coverage at the 80% threshold — the same command anyone runs locally, so the two cannot drift.                        |
| **Deploy to GitHub Pages**                | Publishes the browser app, only after both of the above are green.                                                                       |

The deploy job serves the artifact the verify job built rather than rebuilding it, so the bytes at
the public URL are the bytes that passed. Nothing in the suite needs repeating by hand — the CLI's
exit codes, report reproducibility, and the browser app's behaviour on a corrupt file are all
asserted there. The workflow file is commented with what each part covers and why.

### Why GitHub Pages

The README claims there is no backend, and the hosting should make that true rather than merely
state it. GitHub Pages serves static files and has no mechanism for running server-side code —
there is no place to put a backend even by accident.

Netlify, Vercel and Cloudflare Pages would all serve this app perfectly well, and each also offers
serverless functions a keystroke away. That is precisely the door [ADR-0006](docs/architecture/adr/0006-no-backend.md)
closes: the moment a "quick endpoint" is available, the architecture's central claim becomes a habit
rather than a property. They would also add a third-party account holding a deploy token, for a
static bundle that needs neither.

## Getting started

```bash
pnpm install
pnpm verify     # typecheck → lint → test → build
```

| Script               | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `pnpm typecheck`     | Whole repo including tests, no emit      |
| `pnpm lint`          | ESLint with type-aware rules             |
| `pnpm test`          | Unit, integration and architecture tests |
| `pnpm test:coverage` | Same, with the 80% threshold enforced    |
| `pnpm build`         | `tsc -b` across project references       |
| `pnpm format`        | Prettier                                 |

Requires Node ≥ 20.11 and pnpm 9.

## Verifying a log

```bash
pnpm build
node packages/cli/dist/bin.js verify fixtures/ardupilot/nominal.bin
```

The full result — provenance, findings, hypotheses and every requirement outcome with its evidence
— goes to stdout as JSON; a one-line summary goes to stderr, so `> result.json` gives a clean
document. The exit status is what a CI pipeline reads:

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | Every requirement that applied passed                        |
| 1    | At least one requirement FAILED                              |
| 2    | Nothing failed, but nothing was conclusively verified either |
| 64   | The command line could not be understood                     |
| 65   | The log could not be read or parsed                          |
| 70   | An unexpected internal failure                               |

**Exit 2 is deliberately not a success.** A flight where every requirement came back INCONCLUSIVE
or NOT_APPLICABLE was not verified, and a green pipeline would report confidence PandaLog does not
have. Operational failures use `sysexits.h` values so 0–2 stay reserved for what the verification
actually concluded — a CI script can tell "the aircraft failed" from "the tool could not run".

### Archiving a report

```bash
node packages/cli/dist/bin.js verify fixtures/ardupilot/degraded-flight.bin \
  --format=markdown > report.md
```

The same run, rendered for a person instead of a machine: provenance, the rules the flight was
checked against and the versions they ran at, every finding with its evidence and the `basis` of
every threshold, every requirement outcome with its reason, and — when a baseline was compared — the
per-axis verdicts.

Two runs over the same log at the same versions produce **byte-identical output apart from the
generation timestamp**, which is why that timestamp is kept out of the provenance block. The report
contains no number that is not in the analysis it reports: `@pandalog/reporting` embeds the
artifacts verbatim rather than projecting them, and a test extracts every rendered quantity and
requires it to be traceable to one (doc 04 §7, ADR-0013). Values are in canonical units, because a
converted number would be one that appears in the report and nowhere else.

## Investigating a flight

```bash
pnpm dev:web            # or: pnpm build && serve apps/web/dist
```

Drop a `.BIN` onto the page. Parsing, analysis and verification run in a Web Worker in your own
browser — there is no server to upload to. Selecting a finding opens doc 03 §5's investigation
workflow: the evidence it rests on, the time window that evidence covers, and every signal it cites
drawn synchronized on that window.

Three things the workspace deliberately will not do:

- **Draw through missing data.** A run of samples that were never recorded breaks the line and is
  labelled as a gap. Interpolating across it would turn a GNSS dropout into a smooth glide.
- **Collapse four verification outcomes into two.** `INCONCLUSIVE` and `NOT_APPLICABLE` are shown as
  themselves, with their meaning spelled out, not folded into a tick.
- **Present a provisional criterion as a settled one.** Every threshold displays its `basis`.
- **Fly the aircraft through a GNSS dropout.** Playback has no position while the receiver had no
  fix, and the ground track breaks rather than drawing a leg nobody recorded.

The map fetches no tiles. A basemap would send the flight's coordinates to a third party every time
someone looked at them, so the track is drawn to scale with its geographic bounds labelled instead
(ADR-0011).

## Architecture

The documents in the repository root are the source of truth, in this order:

| Document                                                                           | Subject                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`01_SYSTEM_ARCHITECTURE.md`](01_SYSTEM_ARCHITECTURE.md)                           | Package graph, pipeline stages, enforcement         |
| [`02_CANONICAL_DATA_MODEL.md`](02_CANONICAL_DATA_MODEL.md)                         | The one data model everything downstream consumes   |
| [`03_ANALYSIS_AND_VERIFICATION.md`](03_ANALYSIS_AND_VERIFICATION.md)               | Finding / Hypothesis / Verification contract        |
| [`04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`](04_CLAUDE_CODE_ENGINEERING_CONTRACT.md) | The enforceable engineering rule set                |
| [`05_IMPLEMENTATION_ROADMAP.md`](05_IMPLEMENTATION_ROADMAP.md)                     | Phase-by-phase deliverables and acceptance criteria |

[`docs/architecture/`](docs/architecture) indexes them, holds the dependency manifest, and holds
the ADRs for significant design decisions.

### The invariants that shape the code

Not style preferences — this is why the packages are split the way they are.

- **One canonical model.** Adapters translate into it. Nothing invents a second representation.
- **Missing data is not zero.** An absent sample becomes `NaN` + `Validity.MISSING`; `NaN` means
  "there is genuinely no number here", so it never stands in for an interpolated one. Consumers
  read `validity`; they never infer it from a value.
- **Units are explicit.** Source units convert to canonical SI through one tested table. An
  unknown unit is an error, never an assumed identity.
- **Time is explicit.** Every dataset carries a `TimeBase` stating how its `t_rel_seconds` axis
  was produced. Unknown synchronisation uncertainty is recorded as `null`, never as `0`.
- **Raw data is immutable.** Derived values are separate artifacts.
- **Fail loudly.** A malformed log raises a structured error; it is never partially salvaged.
- **"Could not check" is not "nothing wrong".** A comparison of two flights answers `SAME`,
  `DIFFERENT` or `INCOMPARABLE`, and an axis that could not be examined is never reported as
  showing no difference — the same refusal verification makes about evidence, one stage further
  along (ADR-0012).
- **The AI cannot overrule any of it.** `@pandalog/ai` is opt-in, sends nothing until a user
  configures a provider and supplies a key, and never sees a raw signal. Every answer is checked
  against the evidence before it is returned: a claim carrying a number the analysis did not
  produce, an evidence reference that does not resolve, or a statement asserting an outcome other
  than the recorded one is removed and listed (ADR-0014). Deleting the package leaves everything
  else building and passing, which is a test rather than a promise.
- **Analysis never depends on the UI.** Every engine must be runnable from a test or a CLI.
- **Evidence is mandatory.** A finding without at least one evidence reference cannot be
  constructed; missing evidence in verification is `INCONCLUSIVE`, never `PASS`.

### Enforcement

The dependency graph is checked by a test, not by convention:

```bash
pnpm test tests/architecture
```

[`tests/architecture/dependency-direction.test.ts`](tests/architecture/dependency-direction.test.ts)
reads the layer manifest and asserts both the declared dependencies and the actual imports. It
catches an upward dependency, an undeclared import, and a `node:` import in a package that must
stay platform-neutral. See [`tests/README.md`](tests/README.md) for the mutations that prove it
can fail.

## Repository layout

```text
packages/          implemented packages
apps/web/           Vue investigation workspace (from Phase H)
docs/architecture/  ADRs and the dependency-layer manifest
fixtures/           fixture logs and their expected outputs
tests/              integration and architecture tests
.github/workflows/  CI
```

## Contributing

`CLAUDE.md` points Claude Code at the documents above; `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`
is the actual rule set. In short:

1. read the architecture documents before changing a contract;
2. write the test first for anything deterministic;
3. if the architecture changes, amend the document and `dependency-layers.json` in the same
   change and add an ADR;
4. run `pnpm verify` before committing.
