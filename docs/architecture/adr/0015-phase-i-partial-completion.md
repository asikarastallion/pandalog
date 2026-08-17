# ADR-0015 — Phase I was marked complete while one of its deliverables was partial

- **Status:** Accepted
- **Date:** 2026-08-17
- **Affects:** `05_IMPLEMENTATION_ROADMAP.md` Phase I and the definition of "complete" in its
  header, `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §12

## Context

A reader comparing the roadmap against the shipped application asked whether Phase I
("Map / 3D / Playback") had been skipped, on the evidence that the README's package table shows no
row for it. Checking that turned up two different answers, one reassuring and one not.

**Phase I was not skipped.** Commit `d0c2dff` delivered it: `apps/web` gained a ground-track view,
an attitude view and a synchronized playback clock; `@pandalog/core-domain` gained `geo.ts`;
`@pandalog/parser-ardupilot` gained the GNSS fix gate that stopped a lost fix being reported as a
position at 0°N 0°E. ADR-0011 recorded its design decisions. The README table shows no Phase I row
because **that table is keyed by package**, and Phase I introduced no new package — it extended
`apps/web`, which the table already attributes to Phase H. That is a presentation gap in one table,
not a missing phase.

**But its stated deliverable was not fully met.** The roadmap asks Phase I for:

> Georeferenced map view, **3D attitude/trajectory playback**, synchronized with the timeline/plots
> state from Phase H.

What shipped is an attitude view: a wireframe airframe rotated by the logged roll/pitch/yaw and
**orthographically projected to 2D SVG from a fixed camera**. It renders a three-dimensional
_orientation_; it is not a three-dimensional _scene_, and there is no trajectory in it at all — no
module in the repository computes a flown path in 3D. The flown path exists only as the 2D ground
track. So of "3D attitude/trajectory playback", roughly the attitude half was delivered and the
trajectory half was not.

That shortfall was stated at the time — in the session summary accompanying the commit, under
"Known gaps": _"No 3D trajectory — the attitude view is a rotating airframe against a fixed horizon,
not a flown path in 3D. … A true 3D path is a real increment I have not claimed."_

**It was never written into the roadmap.** The Phase I block says `✅ complete` and records the
GNSS defect and ADR-0011, but says nothing about the missing trajectory. The caveat lived in a
conversation; the permanent record did not carry it.

## Decision

**1. The Phase I roadmap entry is corrected** to `✅ complete (one deliverable partial)`, with the
shortfall named in the entry itself rather than in a linked document.

**2. The gap is closed rather than merely recorded.** A real 3D playback view — perspective camera,
the flown trajectory in three dimensions, the airframe oriented along it — is delivered in the same
change as this ADR, as part of the workspace restructure (see `01_SYSTEM_ARCHITECTURE.md` §5.1).

**3. "Complete" is tightened.** A phase may be marked complete with a deliverable outstanding, but
only if the roadmap entry itself names what is outstanding. A gap that exists only in a commit
message or a chat summary does not count as recorded, because neither is where anyone looks to find
out what the system does.

**4. The README package table gains a note** saying it is keyed by package, so a phase that extends
an application is not mistaken for one that never happened.

## Reason

The failure here is not the missing feature. Shipping the attitude half first was a reasonable call:
it is what playback needed to be useful, and a 3D trajectory is genuinely a larger piece of work.
Deferring it was defensible.

The failure is that **the roadmap said complete and the caveat lived somewhere else**. The document
exists precisely so that someone who was not present can find out where the project stands, and it
was the one place the limitation was absent. Anyone reading it — including a future session of this
project — would have concluded the 3D deliverable was done. The reader who raised this reached the
opposite conclusion, that the phase had been skipped entirely, and was closer to right than the
document was.

The rule in decision 3 follows directly. Doc 04 §12 already requires a phase to end with a roadmap
status update; what it did not say is that the update must be _complete about what is incomplete_.
Chat summaries are not durable, commit messages are not read by users, and both were used here in
place of the document that is.

## Consequences

- Phase I's entry now reads as partial-then-closed, with the history visible rather than tidied
  away. A reader can see what was claimed, what was actually delivered, and when the gap was closed.
- Doc 04 §12's completion routine is amended to require outstanding deliverables to be named in the
  roadmap entry.
- The same audit applied to the other phases found no comparable case: every other "known gap"
  reported in conversation (synthetic fixtures, provisional thresholds, no persistence, single-log
  CLI) is also written into the roadmap, the README, or `fixtures/ardupilot/README.md`.
- This ADR does not change any code contract. It is recorded as an ADR rather than a commit message
  because it changes what "complete" means, and that is a process decision the next person needs.

## Alternatives rejected

- **Quietly implementing the 3D view and leaving the roadmap alone.** The code would be right and
  the record would still be wrong — and the record being wrong is the actual defect.
- **Downgrading Phase I to incomplete.** Inaccurate in the other direction: the map, the playback
  clock, the projection and a real parser defect all shipped and are in use.
- **Treating the README table as the bug.** It is _a_ bug and is fixed, but fixing only that would
  leave the roadmap still claiming a 3D trajectory that does not exist.
