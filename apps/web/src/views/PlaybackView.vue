<script setup lang="ts">
/**
 * 3D playback — the Phase I deliverable ADR-0015 records as having been outstanding.
 *
 * The flown path in perspective, the aircraft on it at the playback instant, and an orbitable
 * camera. Everything geometric comes from `scene3d.ts` and `trajectory.ts`, both pure and tested;
 * this component arranges SVG and handles the pointer (doc 04 §1 rule 1).
 *
 * Honest about what it is: painter-sorted line work with a perspective camera. There is no
 * lighting, no depth buffer and no occlusion — a diagram of a trajectory drawn in perspective,
 * which is what reading a flight path needs, rather than a rendered scene.
 *
 * The path breaks wherever the ground track breaks. An unbroken line through a GNSS outage would
 * be the same invention the 2D view refuses to make.
 */
import { computed, ref } from 'vue';

import { attitudeGlyph } from '../workspace/attitude3d.js';
import { formatCanonical, VALIDITY_MEANING } from '../workspace/format.js';
import { ATTITUDE_SIGNAL_IDS, channelIsUsable, type PlaybackState } from '../workspace/playback.js';
import {
  byDepth,
  clampElevation,
  frameTrajectory,
  groundGrid,
  projectPoint,
  projectPolyline,
  type Camera,
} from '../workspace/scene3d.js';
import { modeFill } from '@pandalog/reporting';
import type { ModeSegment } from '@pandalog/events';

import { modeLegend, splitByMode } from '../workspace/mode-track.js';
import { trajectoryAt, trajectoryPoints, type Trajectory } from '../workspace/trajectory.js';

const props = defineProps<{
  trajectory: Trajectory | null;
  playback: PlaybackState | null;
  modes: readonly ModeSegment[];
}>();

const WIDTH = 760;
const HEIGHT = 460;

/** Orbit offsets applied on top of the auto-framed camera, so reframing never loses the user's view. */
const orbit = ref({ azimuthRad: 0, elevationRad: 0, zoom: 1 });

const points = computed(() =>
  props.trajectory === null ? [] : trajectoryPoints(props.trajectory),
);

const camera = computed<Camera>(() => {
  const framed = frameTrajectory(points.value);
  return {
    ...framed,
    azimuthRad: framed.azimuthRad + orbit.value.azimuthRad,
    elevationRad: clampElevation(framed.elevationRad + orbit.value.elevationRad),
    distanceMeters: framed.distanceMeters * orbit.value.zoom,
  };
});

const gridSegments = computed(() => {
  const extent = camera.value.distanceMeters * 1.5;
  return groundGrid(extent, 10)
    .flatMap((line) => projectPolyline(line, camera.value, WIDTH, HEIGHT))
    .sort(byDepth);
});

/**
 * One polyline per flown run, cut again where the mode changed, so a break stays a break and a mode
 * change is visible in three dimensions the same way it is on the map.
 *
 * The colour is `mode-track.ts`'s, which is `@pandalog/reporting`'s assignment — the same mode is
 * the same colour here, on the ground track, and behind every Summary chart.
 */
const pathSegments = computed(() =>
  splitByMode(props.trajectory?.segments ?? [], props.modes)
    .flatMap((piece) =>
      projectPolyline([...piece.points], camera.value, WIDTH, HEIGHT).map((segment) => ({
        ...segment,
        stroke: piece.colorIndex < 0 ? null : modeFill(piece.colorIndex),
        unrecorded: piece.mode === null,
      })),
    )
    .sort(byDepth),
);

const legend = computed(() => modeLegend(props.modes));

/** Vertical drop lines to the ground plane — what makes height legible in a line drawing. */
const dropLines = computed(() => {
  const segments = props.trajectory?.segments ?? [];
  const lines = [];
  for (const segment of segments) {
    // Every eighth point: enough to read the height profile, few enough to stay a diagram.
    for (let index = 0; index < segment.length; index += 8) {
      const point = segment[index];
      if (point === undefined) {
        continue;
      }
      const top = projectPoint(point, camera.value, WIDTH, HEIGHT);
      const foot = projectPoint({ ...point, z: 0 }, camera.value, WIDTH, HEIGHT);
      if (top !== null && foot !== null) {
        lines.push({ top, foot });
      }
    }
  }
  return lines;
});

/** The aircraft at the playback instant, if the path covers it. */
const vehicle = computed(() => {
  const trajectory = props.trajectory;
  const state = props.playback;
  if (trajectory === null || state === null) {
    return null;
  }

  const world = trajectoryAt(trajectory, state.tSeconds);
  if (world === null) {
    return null;
  }

  const screen = projectPoint(world, camera.value, WIDTH, HEIGHT);
  if (screen === null) {
    return null;
  }

  // Scale the glyph with distance, so the airframe reads as being on the path rather than pasted
  // over it. The attitude itself comes from the same tested rotation the 2D view uses.
  const scale = Math.max(28, Math.min(90, (camera.value.distanceMeters / screen.depth) * 42));
  const attitude = state.attitude;

  return {
    screen,
    scale,
    glyph:
      attitude === null
        ? null
        : attitudeGlyph(attitude.rollRad, attitude.pitchRad, attitude.yawRad, scale),
  };
});

const missingAxes = computed(() =>
  Object.values(ATTITUDE_SIGNAL_IDS)
    .map((id) => ({ id, channel: props.playback?.channels.get(id) }))
    .filter((entry) => !channelIsUsable(entry.channel)),
);

const altitudeReadout = computed(() => {
  const altitude = props.playback?.position?.altitudeMeters;
  return altitude === null || altitude === undefined ? null : formatCanonical(altitude, 'm', 1);
});

// --- pointer orbit -------------------------------------------------------------------------
let dragging: { x: number; y: number } | null = null;

const onPointerDown = (event: PointerEvent): void => {
  dragging = { x: event.clientX, y: event.clientY };
  (event.target as Element).setPointerCapture(event.pointerId);
};

const onPointerMove = (event: PointerEvent): void => {
  if (dragging === null) {
    return;
  }
  const dx = event.clientX - dragging.x;
  const dy = event.clientY - dragging.y;
  dragging = { x: event.clientX, y: event.clientY };

  orbit.value = {
    ...orbit.value,
    azimuthRad: orbit.value.azimuthRad - dx * 0.008,
    elevationRad: orbit.value.elevationRad + dy * 0.006,
  };
};

const onPointerUp = (): void => {
  dragging = null;
};

const onWheel = (event: WheelEvent): void => {
  event.preventDefault();
  const factor = event.deltaY > 0 ? 1.1 : 1 / 1.1;
  orbit.value = { ...orbit.value, zoom: Math.max(0.25, Math.min(6, orbit.value.zoom * factor)) };
};

const resetView = (): void => {
  orbit.value = { azimuthRad: 0, elevationRad: 0, zoom: 1 };
};
</script>

<template>
  <div class="playback-view">
    <div v-if="!trajectory || trajectory.pointCount === 0" class="absent">
      <p v-if="trajectory?.altitudeMissing">
        This flight logged position but no usable altitude, so there is no path to draw in three
        dimensions. The ground track shows where it flew; the height is simply not in the log.
      </p>
      <p v-else>
        This flight logged no usable position, so there is no trajectory to show. Either the vehicle
        carries no GNSS receiver, or it never obtained a fix.
      </p>
    </div>

    <template v-else>
      <div class="scene-wrap">
        <svg
          :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
          class="scene"
          role="img"
          aria-label="Flight trajectory in three dimensions"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel="onWheel"
        >
          <line
            v-for="(segment, index) in gridSegments"
            :key="`g${index}`"
            :x1="segment.from.x"
            :y1="segment.from.y"
            :x2="segment.to.x"
            :y2="segment.to.y"
            class="grid"
          />

          <line
            v-for="(line, index) in dropLines"
            :key="`d${index}`"
            :x1="line.top.x"
            :y1="line.top.y"
            :x2="line.foot.x"
            :y2="line.foot.y"
            class="drop"
          />

          <line
            v-for="(segment, index) in pathSegments"
            :key="`p${index}`"
            :x1="segment.from.x"
            :y1="segment.from.y"
            :x2="segment.to.x"
            :y2="segment.to.y"
            class="path"
            :class="{ unrecorded: segment.unrecorded }"
            :stroke="segment.stroke ?? undefined"
          />

          <g v-if="vehicle" :transform="`translate(${vehicle.screen.x}, ${vehicle.screen.y})`">
            <circle r="3.5" class="marker" />
            <g
              v-if="vehicle.glyph"
              :transform="`translate(${-vehicle.scale / 2}, ${-vehicle.scale / 2})`"
            >
              <line
                v-for="(edge, index) in vehicle.glyph.edges"
                :key="index"
                :x1="edge[0].x"
                :y1="edge[0].y"
                :x2="edge[1].x"
                :y2="edge[1].y"
                class="airframe"
              />
            </g>
          </g>
        </svg>

        <div class="hint">Drag to orbit · scroll to zoom</div>
        <button type="button" class="reset" @click="resetView">Reset view</button>

        <ul v-if="legend.length > 0" class="mode-legend" aria-label="Flight modes">
          <li v-for="entry in legend" :key="entry.label">
            <span
              class="mode-swatch"
              :style="{
                background: entry.colorIndex < 0 ? 'var(--fg-dim)' : modeFill(entry.colorIndex),
              }"
              aria-hidden="true"
            />
            {{ entry.label }}
          </li>
        </ul>
      </div>

      <div class="readout">
        <div v-if="altitudeReadout">
          <dt>Height</dt>
          <dd class="mono">{{ altitudeReadout.text }} {{ altitudeReadout.unit }}</dd>
        </div>
        <div v-if="trajectory.altitudeRange">
          <dt>Altitude flown</dt>
          <dd class="mono">
            {{ trajectory.altitudeRange.minMeters.toFixed(1) }} –
            {{ trajectory.altitudeRange.maxMeters.toFixed(1) }} m
          </dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd class="mono">
            {{ trajectory.pointCount }} points, {{ trajectory.segments.length }} segment{{
              trajectory.segments.length === 1 ? '' : 's'
            }}
          </dd>
        </div>
      </div>

      <p v-if="trajectory.segments.length > 1" class="note">
        The path is drawn in {{ trajectory.segments.length }} pieces. Each break is a stretch where
        the log carried no usable position — the line stops rather than guessing the route across
        it.
      </p>

      <p v-if="!vehicle" class="note warn">
        No position at this instant, so the aircraft is not drawn. The path it flew either side of
        the gap is still shown.
      </p>

      <p v-if="vehicle && !vehicle.glyph" class="note warn">
        Position is known at this instant but attitude is not, so the marker is shown without an
        airframe.
        <span v-for="entry in missingAxes" :key="entry.id" class="mono">
          {{ entry.id }} —
          {{ entry.channel ? VALIDITY_MEANING[entry.channel.validity] : 'not logged' }}
        </span>
      </p>

      <p class="note dim">
        Height is drawn relative to the lowest usable altitude in this flight; the readouts show the
        canonical values. Line work with a perspective camera — there is no lighting or occlusion.
      </p>
    </template>
  </div>
</template>

<style scoped>
.playback-view {
  display: grid;
  gap: 0.8rem;
  max-width: 60rem;
}

.scene-wrap {
  position: relative;
}

.scene {
  width: 100%;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 4px;
  touch-action: none;
  cursor: grab;
}

.scene:active {
  cursor: grabbing;
}

.grid {
  stroke: var(--border);
  stroke-width: 0.6;
  opacity: 0.5;
}

.drop {
  stroke: var(--accent-dim);
  stroke-width: 0.6;
  opacity: 0.45;
}

.path {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

/* A stretch the log stated no mode for: grey and dashed, so it does not read as another mode. */
.path.unrecorded {
  stroke: var(--fg-dim);
  stroke-dasharray: 5 4;
}

.mode-legend {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.7rem;
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.mode-legend li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.mode-swatch {
  width: 0.7rem;
  height: 0.25rem;
  border-radius: 1px;
  display: inline-block;
}

.marker {
  fill: var(--warn);
}

.airframe {
  stroke: var(--warn);
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.hint,
.reset {
  position: absolute;
  bottom: 0.5rem;
  font-size: 0.68rem;
  color: var(--fg-dim);
}

.hint {
  left: 0.7rem;
}

.reset {
  right: 0.7rem;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--fg-dim);
  padding: 0.15rem 0.45rem;
  cursor: pointer;
  font-family: inherit;
}

.reset:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.readout {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}

.readout div {
  display: grid;
  gap: 0.1rem;
}

dt {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
}

dd {
  margin: 0;
  font-size: 0.85rem;
}

.note {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.55;
  color: var(--fg-dim);
}

.note.warn {
  color: var(--warn);
}

.note.dim {
  opacity: 0.8;
}

.mono {
  font-family: var(--mono);
}

.absent {
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  padding: 1.25rem;
  color: var(--warn);
  font-size: 0.82rem;
  line-height: 1.6;
}

.absent p {
  margin: 0;
}
</style>
