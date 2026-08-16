# ADR-0006 — No backend: a static client-side app plus a Node CLI

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context source:** `01_SYSTEM_ARCHITECTURE.md` §2 and `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §8
  (this ADR records the decision those sections state; they remain normative)

## Context

Flight logs are sensitive operational data. A conventional web architecture would upload a log to a
server for parsing and analysis, which introduces data custody, infrastructure to secure and scale,
and an operator who can see the user's flights.

PandaLog's analysis packages are pure computation over a canonical dataset. Nothing in the pipeline
inherently requires a server.

## Decision

**No backend.** PandaLog ships as two deployable artifacts consuming the same core packages:

- **`apps/web`** — a static single-page application. The log is read, parsed, analysed and verified
  entirely client-side: main-thread orchestration with heavy work in Web Workers. Persistence
  (parsed datasets, derived signals, findings, verification results, baselines) uses IndexedDB.
  Deployable as static files to any static host.
- **`@pandalog/cli`** — the same pipeline running headless under Node for automation and CI.

This is what makes every package from `@pandalog/schema` through `@pandalog/reporting`
`platformNeutral: true`: no `node:*` imports and no DOM assumptions, so identical code runs inside a
browser Worker and inside the CLI. The two artifacts differ only in _how they invoke_ the pipeline
and _where they read files from_, never in what the pipeline computes.

## Consequences

- No package may assume a server-side execution context (session storage, server database,
  server-side auth) for core functionality. A feature that appears to need one is a
  product-defining decision requiring a new ADR — not a default to reach for.
- `packages/ai` (Phase L, opt-in) is the one place an external network call is expected. It talks
  directly from the client to whatever LLM provider the user configured, using a key the user
  supplies. PandaLog does not proxy or relay this, because there is no infrastructure to relay
  through.
- No secret API keys may be embedded in the shipped `apps/web` bundle.
- A user's flight logs are not uploaded anywhere by default.
- Multi-device sync, team sharing and hosted storage are out of scope unless a future ADR revisits
  this. Do not partially build toward them — in particular, no speculative server-shaped types in
  `packages/schema`.
- Very large logs must be handled within the browser's memory budget. This is why doc 04 §6 requires
  typed arrays, worker execution, chunking and IndexedDB rather than "load it all and see".

## Alternatives rejected

- **Server-side parsing and analysis.** Would remove the browser memory ceiling, but puts the
  user's flight data in someone else's custody and creates infrastructure that must be secured,
  scaled and paid for. Rejected on data custody grounds first, cost second.
- **Optional self-hosted backend.** Every core package would have to be written twice, or written
  against an abstraction that assumes remote execution. The `platformNeutral` guarantee — and with
  it the ability to run the exact analysis code in CI and in the browser — would be lost.
