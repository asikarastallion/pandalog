# ADR-0008 — Layer numbers express dependency direction, not roadmap order

- **Status:** Accepted
- **Date:** 2026-08-16
- **Affects:** `docs/architecture/dependency-layers.json`, `01_SYSTEM_ARCHITECTURE.md` §3

## Context

`01_SYSTEM_ARCHITECTURE.md` §3 rule 1 and `dependency-layers.json` rule 1 both state:

> Dependencies only point toward lower layer numbers.

The manifest did not satisfy its own rule. `tests/architecture/dependency-direction.test.ts`
caught it on its first run:

| Package               | Layer | Depends on             | Its layer |
| --------------------- | ----- | ---------------------- | --------- |
| `@pandalog/cli`       | 8     | `@pandalog/reporting`  | 9         |
| `@pandalog/web`       | 8     | `@pandalog/reporting`  | 9         |
| `@pandalog/reporting` | 9     | `@pandalog/comparison` | 9         |

The cause is visible in the original ordering: layers 8, 9 and 10 tracked the roadmap phases that
introduce those packages (G/H for the applications, J/K for comparison and reporting, L for AI)
rather than the direction their dependencies actually run. The applications are built early
because they are how a user sees the system, but they sit on top of everything.

## Decision

Layer numbers are a topological grading of the dependency graph. Each package's layer is strictly
greater than the layer of everything in its `allowedDependencies`:

| Layer | Packages                              |
| ----- | ------------------------------------- |
| 0-7   | unchanged (schema … verification)     |
| 9     | `@pandalog/comparison`                |
| 10    | `@pandalog/reporting`, `@pandalog/ai` |
| 11    | `@pandalog/cli`, `@pandalog/web`      |

Roadmap phase and layer number are independent, and `introducedInPhase` remains the field that
records build order.

## Reason

The rule and the numbering could not both stand, and only one of them can be mechanically checked.
A layer number that does not order dependencies cannot enforce anything — it becomes a comment.
Grading the graph makes "dependencies point downward" a property a test can assert, which is the
entire purpose of having the manifest be data rather than prose.

**No dependency relationship changed.** Every `allowedDependencies` list is byte-identical to what
it was; only the integers labelling the levels moved. Nothing about what may import what is
different before and after this ADR.

## Consequences

- `checkManifestConsistency` enforces strictly-downward grading, so a future entry whose layer
  contradicts its dependencies fails the build instead of being merged.
- Manifest rule 4 ("packages sharing a layer number have no dependency relationship between them
  unless explicitly listed") now describes a situation that does not occur: after the regrading no
  package depends on another at the same layer. `reporting` and `ai` share layer 10 with no
  relationship, as do `cli` and `web` at 11. Introducing a same-layer dependency would need its
  own ADR, because it would mean the grading is wrong again.
- Reading the manifest no longer suggests the applications are built beneath comparison and
  reporting.

## Alternatives rejected

- **Relax rule 1 to allow same-layer or upward edges for applications.** Rejected: it would carve
  an exception for exactly the packages most likely to accumulate accidental coupling, and the
  check would no longer mean anything for them.
- **Leave the numbering and drop the rule.** Rejected: the manifest exists to be enforced. Without
  the ordering property, the only thing left to check is `allowedDependencies` membership, and the
  layer field would be decorative.
