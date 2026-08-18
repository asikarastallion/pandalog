<script setup lang="ts">
/**
 * Every detected event across the flight.
 *
 * An event is a fact, not a judgement (doc 03 §1), so nothing here is coloured by severity — that
 * would import a claim the events layer deliberately does not make. The band shows where the open
 * investigation sits, so a finding can be placed against the whole flight.
 *
 * Above the marks runs a mode strip: the flight divided into the modes it was flown in, coloured to
 * match the ground track, the 3D path and the Summary charts. It is the same fact the marks carry —
 * a mode change is an event — shown as the interval it implies rather than as an instant, which is
 * what makes "the excursion happened in this mode" readable at a glance. A period the log stated no
 * mode for is hatched, not coloured (ADR-0016).
 */
import { computed } from 'vue';

import { modeFill } from '@pandalog/reporting';
import type { FlightEvent, ModeSegment } from '@pandalog/events';
import type { TimeWindow } from '@pandalog/query';

import { formatSeconds } from '../workspace/format.js';
import { modeLegend } from '../workspace/mode-track.js';
import { timeToX } from '../workspace/plot.js';

const props = defineProps<{
  events: readonly FlightEvent[];
  window: TimeWindow;
  highlight: TimeWindow | null;
  /** Empty means the log carries no mode information; the strip is then not drawn at all. */
  modes?: readonly ModeSegment[];
}>();

const WIDTH = 720;
const HEIGHT = 34;
const STRIP_HEIGHT = 10;

const marks = computed(() =>
  props.events.map((event) => {
    const x = timeToX(event.t_start_seconds, props.window, WIDTH);
    const end = event.t_end_seconds ?? event.t_start_seconds;
    return {
      id: event.id,
      type: event.type,
      x,
      width: Math.max(2, timeToX(end, props.window, WIDTH) - x),
      label: `${event.type} at ${formatSeconds(event.t_start_seconds)}`,
    };
  }),
);

const modeStrip = computed(() =>
  (props.modes ?? []).map((segment) => {
    const x = timeToX(segment.startSeconds, props.window, WIDTH);
    const end = timeToX(segment.endSeconds, props.window, WIDTH);
    const colors = legend.value.find((entry) => entry.mode === segment.mode);
    return {
      key: `${String(segment.startSeconds)}-${String(segment.mode)}`,
      x,
      width: Math.max(1, end - x),
      fill: (colors?.colorIndex ?? -1) < 0 ? 'var(--fg-dim)' : modeFill(colors?.colorIndex ?? 0),
      unrecorded: segment.mode === null,
      label: `${colors?.label ?? 'Mode not recorded'} — ${formatSeconds(segment.startSeconds)} to ${formatSeconds(segment.endSeconds)}`,
    };
  }),
);

const legend = computed(() => modeLegend(props.modes ?? []));

const band = computed(() => {
  if (props.highlight === null) {
    return null;
  }
  const x = timeToX(props.highlight.startSeconds, props.window, WIDTH);
  const end = timeToX(props.highlight.endSeconds, props.window, WIDTH);
  return { x, width: Math.max(1, end - x) };
});
</script>

<template>
  <section class="timeline" aria-labelledby="timeline-heading">
    <h2 id="timeline-heading">Timeline</h2>

    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="canvas"
      role="img"
      aria-label="Detected events across the flight"
      preserveAspectRatio="none"
    >
      <rect v-if="band" :x="band.x" :width="band.width" y="0" :height="HEIGHT" class="band" />

      <rect
        v-for="strip in modeStrip"
        :key="strip.key"
        :x="strip.x"
        :width="strip.width"
        y="0"
        :height="STRIP_HEIGHT"
        :fill="strip.fill"
        :fill-opacity="strip.unrecorded ? 0.25 : 0.75"
      >
        <title>{{ strip.label }}</title>
      </rect>
      <rect
        v-for="mark in marks"
        :key="mark.id"
        :x="mark.x"
        :width="mark.width"
        y="8"
        :height="HEIGHT - 16"
        class="mark"
      >
        <title>{{ mark.label }}</title>
      </rect>
    </svg>

    <p class="axis">
      <span>{{ formatSeconds(window.startSeconds) }}</span>
      <span>{{ events.length }} events</span>
      <span>{{ formatSeconds(window.endSeconds) }}</span>
    </p>

    <ul v-if="legend.length > 0" class="mode-legend" aria-label="Flight modes">
      <li v-for="entry in legend" :key="entry.label">
        <span
          class="mode-swatch"
          :style="{
            background: entry.colorIndex < 0 ? 'var(--fg-dim)' : modeFill(entry.colorIndex),
            opacity: entry.mode === null ? 0.4 : 0.85,
          }"
          aria-hidden="true"
        />
        {{ entry.label }}
      </li>
    </ul>
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
  height: 34px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.band {
  fill: var(--evidence-band);
}

.mark {
  fill: var(--accent-dim);
}

.axis {
  display: flex;
  justify-content: space-between;
  margin: 0.25rem 0 0;
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--fg-dim);
}

.mode-legend {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.7rem;
  font-size: 0.68rem;
  color: var(--fg-dim);
}

.mode-legend li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.mode-swatch {
  width: 0.7rem;
  height: 0.3rem;
  border-radius: 1px;
  display: inline-block;
}
</style>
