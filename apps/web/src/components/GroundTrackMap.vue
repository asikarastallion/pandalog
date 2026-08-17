<script setup lang="ts">
/**
 * Ground track — ADR-0011.
 *
 * No basemap, and that is a decision rather than an omission: fetching tiles would send the
 * flight's coordinates to a third party every time someone looked at them, from an application
 * whose front page promises the log never leaves the machine. What a ground track is read for —
 * the shape of the path, its size, and where it was — is all here, with a scale bar and the
 * geographic bounds labelled.
 *
 * A break in the line is a stretch with no fix. Joining across it would draw a leg that was never
 * flown, and the longer the outage the more confident the invented leg would look.
 */
import { computed } from 'vue';

import { formatCanonical } from '../workspace/format.js';
import type { PlaybackState } from '../workspace/playback.js';
import {
  projectOntoTrack,
  trackGeoBounds,
  trackViewport,
  type GroundTrack,
} from '../workspace/track.js';

const props = defineProps<{
  track: GroundTrack;
  playback: PlaybackState | null;
}>();

const SIZE = 360;

const viewport = computed(() => trackViewport(props.track, SIZE, SIZE));

const polylines = computed(() =>
  props.track.segments.map((segment) =>
    segment
      .map(
        (point) =>
          `${viewport.value.toX(point.eastMeters).toFixed(2)},${viewport.value.toY(point.northMeters).toFixed(2)}`,
      )
      .join(' '),
  ),
);

/** Where the vehicle is at the playback instant, or null while it has no fix. */
const marker = computed(() => {
  const offset = projectOntoTrack(props.track, props.playback?.position ?? null);
  return offset === null
    ? null
    : { x: viewport.value.toX(offset.eastMeters), y: viewport.value.toY(offset.northMeters) };
});

/** A round number of metres that fits comfortably across the view. */
const scaleBar = computed(() => {
  const targetPixels = SIZE / 4;
  const rawMetres = targetPixels * viewport.value.metresPerPixel;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawMetres, 1)));
  const metres = Math.max(1, Math.round(rawMetres / magnitude) * magnitude);
  return { metres, pixels: metres / viewport.value.metresPerPixel };
});

const bounds = computed(() => trackGeoBounds(props.track));
// Through core-domain's table, like every other unit in the app (doc 04 §1 rule 7).
const degrees = (radians: number): string => formatCanonical(radians, 'rad', 5).text;
</script>

<template>
  <section class="map" aria-labelledby="map-heading">
    <h2 id="map-heading">Ground track</h2>

    <p v-if="track.pointCount === 0" class="empty">
      This flight logged no usable position. Either the vehicle carries no GNSS receiver, or it
      never obtained a fix.
    </p>

    <template v-else>
      <svg
        :viewBox="`0 0 ${SIZE} ${SIZE}`"
        class="canvas"
        role="img"
        aria-label="Ground track, north up"
      >
        <polyline
          v-for="(points, index) in polylines"
          :key="index"
          :points="points"
          class="track"
        />
        <circle v-if="marker" :cx="marker.x" :cy="marker.y" r="4" class="marker" />
        <g class="scale">
          <line
            :x1="12"
            :x2="12 + scaleBar.pixels"
            :y1="SIZE - 16"
            :y2="SIZE - 16"
            class="scale-bar"
          />
          <text :x="12" :y="SIZE - 22" class="scale-label">{{ scaleBar.metres }} m</text>
        </g>
        <text :x="SIZE - 10" y="16" class="compass">N ↑</text>
      </svg>

      <p class="facts">
        <span v-if="track.gapCount > 0" class="gaps">
          {{ track.gapCount }} stretch{{ track.gapCount === 1 ? '' : 'es' }} with no fix — the line
          breaks rather than guessing the path
        </span>
        <span v-else>Continuous fix throughout</span>
      </p>

      <p v-if="bounds" class="bounds">
        {{ degrees(bounds.southRad) }}…{{ degrees(bounds.northRad) }} N,
        {{ degrees(bounds.westRad) }}…{{ degrees(bounds.eastRad) }} E
      </p>

      <p v-if="playback && !playback.position" class="no-fix">
        No position at this instant — the receiver had no fix.
      </p>
    </template>
  </section>
</template>

<style scoped>
h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0 0 0.5rem;
}

.canvas {
  width: 100%;
  max-width: 360px;
  aspect-ratio: 1;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.track {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.marker {
  fill: var(--warn);
  stroke: var(--surface-sunken);
  stroke-width: 1.5;
}

.scale-bar {
  stroke: var(--fg-dim);
  stroke-width: 2;
}

.scale-label,
.compass {
  fill: var(--fg-dim);
  font-size: 10px;
  font-family: var(--mono);
}

.compass {
  text-anchor: end;
}

.facts,
.bounds,
.no-fix,
.empty {
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 0.4rem 0 0;
  color: var(--fg-dim);
}

.bounds {
  font-family: var(--mono);
  font-size: 0.68rem;
}

.gaps {
  color: var(--warn);
}

.no-fix {
  color: var(--warn);
}
</style>
