# Tests

```text
tests/architecture/     boundary enforcement that spans packages
packages/*/test/        unit tests for one package
fixtures/               golden inputs paired with expected outputs (from Phase B)
```

`pnpm test` runs all of them. Architecture tests are part of the suite, not an optional extra
check (doc 04 §5).

## Architecture tests

| File                                                                                     | Enforces                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`architecture/dependency-direction.test.ts`](architecture/dependency-direction.test.ts) | The package graph in `docs/architecture/dependency-layers.json` (doc 01 §6) |
| [`architecture/schema-purity.test.ts`](architecture/schema-purity.test.ts)               | `@pandalog/schema` stays types-and-guards only (doc 02 §3 invariant 4)      |

The dependency check is split so the rules can be tested independently of the filesystem:

- `manifest.ts` — loads the manifest
- `scan-imports.ts` — extracts module specifiers with the TypeScript compiler API, so `import`,
  `import type`, `export … from`, dynamic `import()` and `import(...)` types are all seen
- `check-dependencies.ts` — the rules, as a pure function over (manifest, scanned imports)

`dependency-direction.test.ts` feeds the pure checker deliberate violations _and_ runs it over the
real source tree. Without the first half, a green result would only prove the check found nothing —
not that it is capable of finding anything.

## Proving the check can fail

The synthetic cases cover every violation kind. To confirm the whole pipeline — scanner, manifest
load, and rules together — introduce a real violation and watch `pnpm test tests/architecture`
turn red. Each of these should be reverted immediately afterwards.

### 1. Upward dependency

In `packages/schema/src/index.ts` (layer 0), import from layer 1:

```ts
import { createTimeBase } from '@pandalog/core-domain';
```

Expected: `UNDECLARED_DEPENDENCY` — `@pandalog/schema` declares no dependencies at all. To see
`UPWARD_DEPENDENCY` specifically, the import must be one the manifest permits but which points the
wrong way; the synthetic test `catches an upward dependency that is otherwise declared` covers
that case by bending the manifest instead of the source.

### 2. Undeclared import

In `packages/core-domain/src/units.ts` (layer 1, may use `@pandalog/schema` only):

```ts
import { ingest } from '@pandalog/ingestion';
```

Expected: `UNDECLARED_DEPENDENCY`, naming the file and the specifier.

### 3. `node:` import in a `platformNeutral` package

In `packages/core-domain/src/time.ts`:

```ts
import { readFileSync } from 'node:fs';
```

Expected: `NODE_IMPORT_IN_PLATFORM_NEUTRAL`. The bare form (`from 'fs'`) is caught too — that is
the loophole a copy-paste from Node-oriented code opens.

Note that `pnpm typecheck` also rejects this one, because every package sets `"types": []`, so
Node's globals are not in scope. The two checks are deliberately independent: the compiler catches
it while you write, the architecture test catches it if the compiler configuration ever loosens.

### 4. Deep import past a package entry point

```ts
import { validateCanonicalFlightDataset } from '@pandalog/schema/src/validation.js';
```

Expected: `DEEP_IMPORT`. A package's public API is what its `index.ts` exports (doc 04 §2).

### 5. A package importing an application

```ts
import { something } from '@pandalog/web';
```

Expected: `APPLICATION_IMPORTED`. Applications depend on packages; packages never depend on an
application.

## Guarding against a vacuous pass

`dependency-direction.test.ts` asserts which packages were actually scanned. Without it, a typo in
a manifest `path` would make every package scan zero files, and the suite would report success
while checking nothing.

## Test conventions

- Test-first for anything deterministic (doc 04 §5).
- Every deterministic calculation gets nominal, boundary, malformed-input, missing-data and
  extreme-value cases.
- Tests name the document clause they enforce, so a failure points at the contract rather than at
  an opinion.
- `pnpm test:coverage` enforces the 80% repo-wide threshold; packages below the application layer
  are expected to sit far above it, since that is where the correctness-critical logic lives.
