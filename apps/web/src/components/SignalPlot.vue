<script setup lang="ts">
/**
 * Synchronized signals over the investigation window — doc 03 §5.
 *
 * The component computes nothing: `buildPlot` returns finished coordinates and `format.ts` returns
 * finished strings (doc 04 §1 rule 1). What it decides is layout.
 *
 * A break in a line is data that was not recorded, and it is labelled as such rather than left for
 * the reader to interpret as a rendering artefact.
 */
import { computed } from 'vue';

import type { FlightEvent } from '@pandalog/events';
import type { TimeWindow } from '@pandalog/query';
import type { Signal } from '@pandalog/schema';

import { formatNumber, formatSeconds } from '../workspace/format.js';
import { buildPlot, pointsAttribute, timeToX } from '../workspace/plot.js';

const props = defineProps<{
  signals: readonly Signal[];
  window: TimeWindow;
  /** The un-padded evidence interval, shaded so context is distinguishable from the claim. */
  evidenceWindow: TimeWindow;
  events: readonly FlightEvent[];
}>();

const WIDTH = 720;
const ROW_HEIGHT = 90;

const plot = computed(() =>
  buildPlot(props.signals, props.window, { width: WIDTH, height: ROW_HEIGHT }),
);

const evidenceBand = computed(() => {
  const x1 = timeToX(props.evidenceWindow.startSeconds, props.window, WIDTH);
  const x2 = timeToX(props.evidenceWindow.endSeconds, props.window, WIDTH);
  return { x: Math.min(x1, x2), width: Math.max(1, Math.abs(x2 - x1)) };
});

const eventMarkers = computed(() =>
  props.events.map((event) => ({
    id: event.id,
    type: event.type,
    x: timeToX(event.t_start_seconds, props.window, WIDTH),
  })),
);
</script>

<template>
  <section class="plots">
    <p v-if="plot.series.length === 0" class="empty">
      This finding cites no signal that the dataset carries.
    </p>

    <figure v-for="series in plot.series" :key="series.signalId" class="plot">
      <figcaption>
        <span class="signal-id">{{ series.signalId }}</span>
        <span class="unit">{{ series.unit }}</span>
        <span v-if="series.gapCount > 0" class="gaps">
          {{ series.gapCount }} gap{{ series.gapCount === 1 ? '' : 's' }} — no data recorded
        </span>
      </figcaption>

      <svg
        :viewBox="`0 0 ${WIDTH} ${ROW_HEIGHT}`"
        class="canvas"
        role="img"
        :aria-label="`${series.signalId} in ${series.unit}`"
        preserveAspectRatio="none"
      >
        <rect
          :x="evidenceBand.x"
          :width="evidenceBand.width"
          y="0"
          :height="ROW_HEIGHT"
          class="evidence-band"
        />
        <line
          v-for="marker in eventMarkers"
          :key="marker.id"
          :x1="marker.x"
          :x2="marker.x"
          y1="0"
          :y2="ROW_HEIGHT"
          class="event-marker"
        />
        <polyline
          v-for="(segment, index) in series.segments"
          :key="index"
          :points="pointsAttribute(segment)"
          class="trace"
        />
        <text v-if="series.pointCount === 0" :x="WIDTH / 2" :y="ROW_HEIGHT / 2" class="no-data">
          no usable samples in this window
        </text>
      </svg>

      <div class="axis">
        <span>{{ formatNumber(series.max, 2) }}</span>
        <span>{{ formatNumber(series.min, 2) }}</span>
      </div>
    </figure>

    <p v-if="plot.series.length > 0" class="time-axis">
      <span>{{ formatSeconds(window.startSeconds) }}</span>
      <span>{{ formatSeconds(window.endSeconds) }}</span>
    </p>
  </section>
</template>

<style scoped>
.plots {
  display: grid;
  gap: 0.75rem;
}

.plot {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: 'caption caption' 'canvas axis';
  gap: 0 0.5rem;
}

figcaption {
  grid-area: caption;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.signal-id {
  font-family: var(--mono);
  color: var(--fg);
}

.unit {
  color: var(--fg-dim);
}

.gaps {
  margin-left: auto;
  color: var(--warn);
}

.canvas {
  grid-area: canvas;
  width: 100%;
  height: 90px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.evidence-band {
  fill: var(--evidence-band);
}

.event-marker {
  stroke: var(--accent-dim);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.trace {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.no-data {
  fill: var(--fg-dim);
  font-size: 11px;
  text-anchor: middle;
}

.axis {
  grid-area: axis;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.time-axis {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.empty {
  color: var(--fg-dim);
  font-size: 0.85rem;
}
</style>
