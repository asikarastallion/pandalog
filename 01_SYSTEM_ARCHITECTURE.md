# 01 — System Architecture

Status: baseline. This document defines the package graph, the pipeline stages, and the
boundaries that are enforced by `tests/architecture/dependency-direction.test.ts` against
`docs/architecture/dependency-layers.json`.

## 1. Pipeline

```text
Flight Log
    │  packages/parser-ardupilot (+ future parser-* adapters)
    ▼
Raw Source Records                         ── format-specific, adapter-internal only
    │  packages/ingestion (canonicalization bridge)
    ▼
CanonicalFlightDataset                     ── 02_CANONICAL_DATA_MODEL.md, immutable
    │  packages/query
    ▼
Derived Signals (typed, unit-explicit)
    │  packages/events
    ▼
Events (discrete, timestamped, evidenced)
    │  packages/analysis
    ▼
Findings + Hypotheses                      ── 03_ANALYSIS_AND_VERIFICATION.md
    │  packages/verification
    ▼
Verification Results (PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE)
    │  packages/comparison (optional, cross-flight)
    ▼
Comparison Results
    │  packages/reporting
    ▼
Reports (reproducible, provenance-stamped)
    │  packages/ai (optional)
    ▼
Structured AI Answers (explanatory only, never authoritative)
```

Every arrow is a package boundary. No stage reaches backward into an earlier stage's internals;
each stage consumes only the public output type of the stage before it.

## 2. Deployment topology (ADR-0006 summary)

**Decision: no backend.** PandaLog ships as two deployable artifacts, both consuming the same
`platformNeutral` core packages, with no server component in between:

- **`apps/web`** — a static single-page application. The user's flight log is read, parsed,
  analyzed, and verified entirely client-side (main thread orchestration, heavy work in Web
  Workers per §4). Nothing is uploaded. Persistence (parsed datasets, derived signals,
  findings, verification results, comparison baselines) uses IndexedDB. Deployable as static
  files to any static host (e.g. Netlify, Vercel, GitHub Pages, or a local `file://`/
  `pnpm --filter web preview` run) — there is no API server to provision, scale, or secure.
- **`@pandalog/cli`** — the same pipeline running headless under Node, for automation/CI use
  (a user's own flight-test pipeline running verification on every log).

Why this holds together: every package from `@pandalog/schema` through `@pandalog/reporting`
is `platformNeutral: true` (§1 table) — no `node:*` imports, no DOM assumptions — so the exact
same ingestion/analysis/verification/reporting code runs unmodified inside a browser Worker or
inside the Node CLI. `apps/web` and `@pandalog/cli` differ only in _how they invoke_ the core
pipeline and _where they read files from_ (File System Access API / drag-and-drop vs. the
filesystem), not in what the pipeline does.

Consequences this constrains going forward:

- No package may assume a server-side execution context (session storage, server database,
  server-side auth) for core functionality. If a future feature seems to need one, that is a
  product-defining decision requiring an ADR before implementation, not a default to reach for.
- `packages/ai` (Phase L, opt-in) is the one place an external network call is expected — it
  talks directly from the client (browser or CLI process) to whatever LLM provider the user has
  configured, using a key the user supplies. PandaLog does not proxy or relay this through
  infrastructure it operates.
- Multi-device sync, team sharing, or hosted storage are explicitly out of scope unless a future
  ADR revisits this decision; do not partially build toward them (e.g. no speculative
  server-shaped types in `packages/schema`).

## 3. Package graph

Authoritative machine-readable form: `docs/architecture/dependency-layers.json`. Summary:

| Layer | Package                      | Depends on                                                 | Phase |
| ----- | ---------------------------- | ---------------------------------------------------------- | ----- |
| 0     | `@pandalog/schema`           | —                                                          | A     |
| 1     | `@pandalog/core-domain`      | schema                                                     | A     |
| 2     | `@pandalog/ingestion`        | schema, core-domain                                        | A     |
| 3     | `@pandalog/parser-ardupilot` | schema, core-domain, ingestion                             | B     |
| 4     | `@pandalog/query`            | schema, core-domain                                        | C     |
| 5     | `@pandalog/events`           | schema, core-domain, query                                 | D     |
| 6     | `@pandalog/analysis`         | schema, core-domain, query, events                         | E     |
| 7     | `@pandalog/verification`     | schema, core-domain, query, events, analysis               | F     |
| 8     | `@pandalog/pipeline`         | everything through verification                            | H     |
| 9     | `@pandalog/comparison`       | schema, core-domain, query, events, analysis, verification | J     |
| 10    | `@pandalog/reporting`        | schema, core-domain, analysis, verification, comparison    | K     |
| 10    | `@pandalog/ai`               | schema, analysis, verification, comparison                 | L     |
| 11    | `@pandalog/cli`              | everything through reporting                               | G     |
| 11    | `apps/web`                   | everything through reporting                               | H     |

Layer number expresses dependency direction, not roadmap order. `cli` and `web` are introduced in
phases G and H but sit at the top of the graph because they consume `reporting`, which is built in
phase K; `introducedInPhase` is the field that records build order. See ADR-0008.

Rules (enforced by test, see §5):

1. Dependencies only point toward lower layer numbers.
2. `apps/web` and `@pandalog/cli` are the only packages that may depend on the full stack; no
   package below layer 8 may import from either.
3. `@pandalog/schema`, `@pandalog/core-domain`, `@pandalog/parser-ardupilot`, `@pandalog/query`,
   `@pandalog/events`, `@pandalog/analysis`, `@pandalog/verification`, `@pandalog/pipeline`,
   `@pandalog/comparison`, `@pandalog/reporting` are `platformNeutral: true` — no `node:*` imports,
   runnable in a worker or in Node without modification. This is the mechanical form of §2's claim
   that the browser runs the same code: the whole chain from a dropped `.BIN` to a verification
   outcome is on this list (ADR-0010).
4. `@pandalog/cli`, `@pandalog/ai`, `apps/web` are allowed platform-specific code (file I/O,
   network, DOM) because their responsibility requires it. A future adapter that genuinely needs a
   platform API declares `platformNeutral: false` for itself rather than reopening
   `parser-ardupilot`.

## 4. Why this shape (ADR-0005 summary)

Each package is a load-bearing boundary, not an organizational convenience:

- **`schema` has zero dependencies** so that any future package — including ones outside this
  repository (e.g. a Python analysis toolchain) — can consume the canonical model without
  pulling in unrelated code.
- **`core-domain` is separate from `ingestion`** so that unit/time normalization logic is
  testable and reusable without a parser, and so a future non-ArduPilot adapter reuses it
  rather than reimplementing conversion.
- **`ingestion` is separate from `parser-ardupilot`** so the adapter _contract_ (what any
  parser must produce) exists independently of any one format. Adding MAVLink or TLOG support
  means adding `parser-mavlink`, `parser-tlog`; it never means editing `ingestion`'s contract
  unless the contract itself is wrong for all adapters.
- **`analysis` depends on `events`, not the reverse**, because a finding is defined in terms of
  events and signals, never the other way around — this keeps event detection reusable by
  things that are not analysis (e.g. a future timeline UI feature).
- **`verification` sits above `analysis`** because a requirement check consumes findings; it is
  not itself a finding.
- **`reporting` performs no calculation** (§19 of `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`) — it
  depends on `analysis`/`verification`/`comparison` only to _render_ their output, which is why
  it does not sit inside those packages.
- **`ai` depends only on the read side of the evidence chain** (`analysis`, `verification`,
  `comparison`, plus `schema`) and nothing depends on `ai` — deleting the package must not
  break any other package's build. This is the mechanical enforcement of "if the AI layer is
  removed, the main product must still function."

## 5. Application boundary (`apps/web`)

`apps/web` is a Vue 3 application. It:

- consumes application/domain services from the packages above the dependency line; it does
  not implement domain logic in components (see `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §UI
  boundary rules);
- never decodes a binary log format directly — decoding is `parser-*` package territory;
- runs heavy work (parsing, FFT, large signal transforms, analysis, report preparation) in Web
  Workers, not on the main thread;
- treats every domain object it renders as coming from a package type in `@pandalog/schema` /
  `@pandalog/analysis` / etc. — it does not define a parallel "UI model" that duplicates the
  canonical shapes. View-specific state (selection, zoom, active tab) is UI state; flight data,
  findings, and verification results are not.

### 5.1 Information architecture (contract, not styling)

The workspace is **navigated, not stacked**. An earlier revision rendered flight metadata, playback,
ground track, timeline, findings and verification onto one scrolling page; every view competed for
the same screen and none of them could grow. The structure below is a contract so that it does not
silently collapse back into one page the next time a view is added.

**Two levels, and only two.**

```text
Landing  ──▶  Workspace(log)  ──▶  one of seven views
```

**Landing** is what the application opens on. It lists previously analysed logs from IndexedDB —
file name, when it was analysed, flight duration, the PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE tally,
and the source SHA-256 — and offers "open a log" at all times. Selecting an entry opens its
workspace. Persistence is local to the browser; it is not a sync feature and there is no server to
sync to (§2).

**Workspace** has a persistent navigation rail and exactly one active view:

| View          | Answers                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| Summary       | What is this flight, and what did the analysis conclude overall?          |
| Plot          | What did these signals do, against each other, over time?                 |
| Map           | Where did it fly? (two modes — §5.2)                                      |
| 3D Playback   | What was it doing at this instant, along the path it actually flew?       |
| Investigation | What was found, what proves it, and what were the samples behind it?      |
| Verification  | Did it meet each requirement, and on what evidence?                       |
| Report        | The reproducible, provenance-stamped document (`@pandalog/reporting`).    |

Rules that make this a contract rather than a layout:

1. **A view answers one question.** A new capability becomes a view, or extends the view whose
   question it belongs to. It does not get appended to whichever page has room.
2. **Investigation and Verification stay separate views.** They are the product's distinguishing
   claim, and each needs a full screen: a finding resolved to its evidence and signals (doc 03 §5),
   and four outcomes shown as four outcomes rather than a tick and a cross.
3. **One clock, one selection.** Playback time, the selected finding and the selected signals live
   in the workspace store and are shared by every view. Switching view never resets them; a finding
   selected in Investigation is the same instant the 3D view is showing.
4. **Views hold no domain logic** (§5 above, doc 04 §1 rules 1-2). They arrange components and read
   the store. Geometry needed only for drawing — projections, scales, glyphs — lives in
   `apps/web/src/workspace/*.ts` as pure functions with tests, never inside a component.
5. **Which view is open is UI state.** It is not persisted into the canonical model and never
   changes what the analysis concluded.

### 5.2 Network access from the browser (map tiles)

Doc §2 says the log never leaves the machine, and that remains true by default. The map therefore has
two modes, and the default is the one that talks to nobody:

- **Local (default).** The ground track is drawn in projected metres with a scale bar and its
  geographic bounds labelled. No request leaves the page. This is ADR-0011's original behaviour and
  it is unchanged.
- **Basemap (opt-in).** Raster tiles from a public OpenStreetMap tile server, behind an explicit,
  informed consent step that states what is sent and to whom. Enabling it is a per-browser choice
  that is remembered; it is never on by default, never inferred, and revocable.

Consent is required because a tile request discloses **where the aircraft flew** to a third party —
the tile coordinates are the flight's location. That is a different disclosure from fetching a
stylesheet, and the user is the only one who can weigh it. See ADR-0011 (revised).

`tests/architecture/dependency-direction.test.ts`:

1. loads `docs/architecture/dependency-layers.json`;
2. for each package, statically walks its source imports (via the TypeScript compiler API or
   an AST import scanner) and asserts every internal `@pandalog/*` import is present in that
   package's `allowedDependencies`;
3. asserts no `platformNeutral: true` package imports a `node:*` builtin;
4. asserts no package outside `apps/web`/`@pandalog/cli` imports either of them.

A structural change (new package, new allowed dependency, layer change) must update
`dependency-layers.json` and this document in the same commit; the test will fail otherwise
because a real import will have no corresponding manifest entry.

See `tests/README.md` for the specific mutation tests that prove the check can fail (upward
dependency, undeclared import, disallowed `node:` import).

## 7. Cross-cutting concerns

| Concern                             | Where it lives                                                 | Not allowed elsewhere                                         |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Unit conversion                     | `core-domain`                                                  | Hard-coded conversion factors anywhere else                   |
| Time normalization                  | `core-domain`                                                  | Ad hoc timestamp math in UI or analysis                       |
| Missing/invalid data representation | `schema` (`Validity`)                                          | Silent coercion to 0/default in any package                   |
| Evidence linkage                    | `analysis` (`Finding.evidence`)                                | A finding constructed without at least one evidence reference |
| Provenance (source hash, versions)  | `schema` (`SourceProvenance`), threaded through to `reporting` | Reports fabricating or omitting provenance                    |
| Configuration/thresholds            | `analysis` rule definitions, versioned                         | Inline magic numbers in rule implementations                  |
