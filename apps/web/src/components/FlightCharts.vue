<script setup lang="ts">
/**
 * The flight, drawn — what an engineer looks at before reading a word.
 *
 * Every curve here is `@pandalog/reporting`'s — both the geometry and the choice of which signals
 * make a panel, so a chart seen here is the same chart the exported report carries. The component
 * computes nothing (doc 04 §1 rule 1); it decides layout, and what to say about a panel the log
 * cannot support.
 *
 * Two things are drawn as facts rather than as decoration:
 *
 *   **A break in a line is data that was not recorded**, labelled as such so it does not read as a
 *   rendering artefact. Drawing through it would show a GPS dropout as a smooth glide.
 *
 *   **A mode band whose boundary the log never recorded is drawn faintly and said so.** The period
 *   before the first `MODE` record is a period the aircraft was in *some* mode and the log does not
 *   say which (ADR-0016).
 */
import { computed } from 'vue';

import { pointsAttribute, type ChartPanel } from '@pandalog/reporting';

import { formatNumber, formatSeconds } from '../workspace/format.js';

const props = defineProps<{
  panels: readonly ChartPanel[];
  window: { readonly startSeconds: number; readonly endSeconds: number };
  size: { readonly width: number; readonly height: number };
}>();

/** Stroke colours, matched to the report's so the same series is the same colour in both. */
const STROKES = ['#4a9eff', '#ff8f4a', '#5fd08a', '#d67cff', '#ffd24a', '#ff6b6b'];
const MODE_FILLS = [
  '#4a9eff',
  '#ff8f4a',
  '#5fd08a',
  '#d67cff',
  '#ffd24a',
  '#ff6b6b',
  '#4adcd0',
  '#a0a8b8',
];

const strokeFor = (index: number): string => STROKES[index % STROKES.length] ?? '#4a9eff';
const fillFor = (colorIndex: number): string =>
  colorIndex < 0 ? '#8a8a8a' : (MODE_FILLS[colorIndex] ?? '#8a8a8a');

/** Distinct modes across the flight, for one legend above all the panels rather than six. */
const legend = computed(() => {
  const seen = new Map<string, { label: string; colorIndex: number; inferred: boolean }>();
  for (const panel of props.panels) {
    for (const band of panel.chart?.bands ?? []) {
      if (!seen.has(band.label)) {
        seen.set(band.label, {
          label: band.label,
          colorIndex: band.colorIndex,
          inferred: band.inferred,
        });
      }
    }
  }
  return [...seen.values()];
});

const drawn = computed(() => props.panels.filter((panel) => panel.chart !== null));
const unavailable = computed(() => props.panels.filter((panel) => panel.chart === null));
</script>

<template>
  <section class="charts" aria-labelledby="charts-heading">
    <div class="head">
      <h3 id="charts-heading">The flight</h3>
      <ul v-if="legend.length > 0" class="legend" aria-label="Flight modes">
        <li v-for="entry in legend" :key="entry.label">
          <span
            class="swatch"
            :class="{ inferred: entry.inferred }"
            :style="{ background: fillFor(entry.colorIndex) }"
            aria-hidden="true"
          />
          {{ entry.label }}<span v-if="entry.inferred" class="hint"> (boundary not recorded)</span>
        </li>
      </ul>
    </div>

    <figure v-for="panel in drawn" :key="panel.id" class="panel">
      <figcaption>
        <span class="title">{{ panel.title }}</span>
        <span class="question">{{ panel.question }}</span>
      </figcaption>

      <svg
        :viewBox="`0 0 ${size.width} ${size.height}`"
        class="canvas"
        role="img"
        :aria-label="panel.title"
        preserveAspectRatio="none"
      >
        <rect
          v-for="(band, index) in panel.chart?.bands ?? []"
          :key="`${panel.id}-band-${index}`"
          :x="band.x"
          :width="band.width"
          y="0"
          :height="size.height"
          :fill="fillFor(band.colorIndex)"
          :fill-opacity="band.inferred ? 0.06 : 0.14"
        >
          <title>
            {{ band.label }} — {{ formatSeconds(band.startSeconds) }} to
            {{ formatSeconds(band.endSeconds) }}
          </title>
        </rect>

        <template v-for="(series, seriesIndex) in panel.chart?.series ?? []" :key="series.signalId">
          <polyline
            v-for="(run, runIndex) in series.segments"
            :key="`${series.signalId}-${runIndex}`"
            :points="pointsAttribute(run)"
            fill="none"
            :stroke="strokeFor(seriesIndex)"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </template>
      </svg>

      <div class="axis">
        <span>{{ formatSeconds(window.startSeconds) }}</span>
        <ul class="series">
          <li v-for="(series, index) in panel.chart?.series ?? []" :key="series.signalId">
            <span class="swatch" :style="{ background: strokeFor(index) }" aria-hidden="true" />
            {{ series.signalId }}
            <span class="range">
              {{ formatNumber(series.min) }}–{{ formatNumber(series.max) }} {{ series.unit }}
            </span>
            <!--
              A break is data that was not recorded, named so it does not read as a rendering
              artefact (doc 04 §1 rule 6).
            -->
            <span v-if="series.gapCount > 0" class="gaps">
              {{ series.gapCount }} break{{ series.gapCount === 1 ? '' : 's' }} — not recorded
            </span>
          </li>
        </ul>
        <span>{{ formatSeconds(window.endSeconds) }}</span>
      </div>

      <p v-if="panel.missingSignalIds.length > 0" class="partial">
        Not drawn, because this log does not carry it:
        <span v-for="id in panel.missingSignalIds" :key="id" class="mono">{{ id }}</span>
      </p>
      <p v-if="panel.usedFallback" class="partial">
        Drawn from a substitute source — the preferred signal is not in this log.
      </p>
    </figure>

    <!--
      Panels that cannot be drawn are listed rather than dropped. A missing panel would make "this
      aircraft logged no voltage" indistinguishable from "this view does not show voltage".
    -->
    <p v-if="unavailable.length > 0" class="unavailable">
      Not shown, because this log carries none of the signals they need:
      <span v-for="panel in unavailable" :key="panel.id" class="unavailable-entry">
        {{ panel.title }} (<span class="mono">{{ panel.missingSignalIds.join(', ') }}</span
        >)
      </span>
    </p>
  </section>
</template>

<style scoped>
.charts {
  display: grid;
  gap: 0.75rem;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}

h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0;
}

.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.swatch {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 2px;
  display: inline-block;
  opacity: 0.75;
}

.swatch.inferred {
  opacity: 0.3;
  border: 1px dashed var(--border-strong);
}

.hint {
  opacity: 0.8;
}

.panel {
  margin: 0;
  display: grid;
  gap: 0.3rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.6rem 0.7rem;
}

figcaption {
  display: grid;
  gap: 0.1rem;
}

.title {
  font-size: 0.82rem;
  font-weight: 600;
}

.question {
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.canvas {
  width: 100%;
  height: 7rem;
  background: var(--surface-sunken);
  border-radius: 3px;
}

.axis {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--fg-dim);
}

.series {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.8rem;
  justify-content: center;
  flex: 1;
}

.series li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.range {
  opacity: 0.75;
}

.gaps {
  color: var(--warn);
}

.partial,
.unavailable {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--fg-dim);
}

.mono {
  font-family: var(--mono);
  margin-right: 0.35rem;
}

.unavailable-entry {
  margin-right: 0.5rem;
}
</style>
