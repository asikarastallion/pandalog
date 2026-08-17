# ADR-0011 — Ground track is projected to a local tangent plane; no basemap is fetched

- **Status:** Accepted
- **Date:** 2026-08-17
- **Affects:** `05_IMPLEMENTATION_ROADMAP.md` Phase I, `@pandalog/core-domain` (new `geo.ts`),
  `apps/web` map view

## Context

Phase I delivers a "georeferenced map view", and states a condition on how:

> Uses position/attitude signals already in the canonical model; does not introduce a new spatial
> data type outside `packages/schema` without an ADR.

Drawing a ground track needs two things the repository does not yet have: a way to turn geographic
coordinates into planar coordinates, and a decision about what the track is drawn _on top of_.

The second question runs into doc 01 §2, which is unusually specific about network access:

> `packages/ai` (Phase L, opt-in) is the one place an external network call is expected

A conventional web map fetches raster tiles from a tile server on every pan and zoom. That is a
second place an external network call would be expected, it would happen by default rather than
opt-in, and it would transmit the flight's coordinates to a third party as a side effect of looking
at them — for a tool whose front page promises the log never leaves the machine, that is a
contradiction a footnote cannot fix.

## Decision

**1. `@pandalog/core-domain` gains `toLocalPlane`**, converting a canonical latitude/longitude (in
radians, as the model stores every angle) to metres east and north of a reference point, using the
WGS-84 radii of curvature at that reference latitude.

The result type is `LocalPlaneOffset { eastMeters, northMeters }`. It is a **rendering artifact, not
a model type**: it is never stored on a `Signal`, never enters a `CanonicalFlightDataset`, and
nothing downstream persists it. `packages/schema` is unchanged, and doc 02's model gains no spatial
type.

It lives in `core-domain` rather than in `apps/web` for the same reason unit conversion does
(doc 04 §1 rule 7): it is a conversion with an earth model and physical constants behind it, and a
component is not where `6378137.0` belongs.

**2. The map draws no basemap.** The ground track is rendered in projected metres with a scale bar
and its geographic bounds labelled. No tiles are fetched, by default or otherwise.

## Reason

**On the projection.** A local tangent plane is the right approximation for the question a flight
log asks. Flights occupy a few kilometres; over that extent, projecting about a reference point with
the local radii of curvature is accurate to well under a metre, and the error is a documented
function of distance rather than an unknown. A general-purpose projection library would bring
datum handling, zone selection and a dependency, to answer a question that is one arc-length
calculation.

The constants are WGS-84 because that is the datum ArduPilot's GNSS output is already in; converting
between datums would be inventing precision the source does not have.

**On the basemap.** Three options were weighed:

- _Fetch tiles by default._ Rejected on doc 01 §2 and on the privacy claim the product makes.
- _Bundle offline tiles._ A world basemap at useful zoom is gigabytes; a regional one presumes where
  the user flies.
- _Draw no basemap._ The track, its scale, and its coordinates are what a flight-test engineer
  reads off a ground track — whether it is over a rendered field or a blank grid does not change
  where the aircraft was. What is lost is context an operator usually already has.

The third is honest about what it does and does not show, and costs nothing at rest.

## Consequences

- The map view answers "what path did it fly, how big was it, and where" — not "what was underneath
  it". That limitation is stated in the UI rather than left to be discovered.
- Adding an opt-in tile provider later is a product decision needing its own ADR, and would follow
  the shape doc 01 §2 already sets for `packages/ai`: off by default, configured by the user,
  talking directly from the client to the provider they chose, with the privacy consequence stated
  at the point of enabling it.
- `toLocalPlane` is approximate by construction. Its tolerance is documented on the function and
  tested at range, so a caller can see where it stops being appropriate rather than discovering it.
- If a spatial type ever does belong in the canonical model — a fused position estimate, say — that
  is a doc 02 change with its own ADR. This decision deliberately does not open that door.

## Alternatives rejected

- **Project in the component.** Puts an earth model and its constants in a `.vue` file, which
  `tests/architecture/ui-boundary.test.ts` forbids and doc 04 §1 rule 7 forbids for the same reason.
- **Add `GeoPosition` to `packages/schema`.** The canonical model already carries latitude and
  longitude as signals with units and validity. A second representation of the same measurement is
  the parallel representation doc 04 rules out, and nothing needs it.
- **Web Mercator.** Correct for tiled basemaps and wrong here: it distorts scale with latitude, so a
  scale bar would be a lie away from the equator, and there are no tiles to line up with anyway.
