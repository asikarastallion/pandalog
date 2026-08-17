<script setup lang="ts">
/**
 * The vehicle's attitude at the playback instant.
 *
 * The wireframe and its rotation come from `workspace/attitude3d.ts`, tested against known poses;
 * this draws them. When any axis is missing the view says so and draws nothing, rather than
 * levelling the aircraft — a glyph sitting flat is indistinguishable from a vehicle that was
 * actually level, and that is exactly the coercion doc 04 §1 rule 6 rules out.
 */
import { computed } from 'vue';

import { attitudeGlyph } from '../workspace/attitude3d.js';
import { formatCanonical, VALIDITY_MEANING } from '../workspace/format.js';
import { ATTITUDE_SIGNAL_IDS, channelIsUsable, type PlaybackState } from '../workspace/playback.js';

const props = defineProps<{ playback: PlaybackState | null }>();

const SIZE = 220;

const glyph = computed(() => {
  const attitude = props.playback?.attitude;
  return attitude === undefined || attitude === null
    ? null
    : attitudeGlyph(attitude.rollRad, attitude.pitchRad, attitude.yawRad, SIZE);
});

const axes = computed(() => {
  const attitude = props.playback?.attitude;
  if (attitude === undefined || attitude === null) {
    return [];
  }
  return [
    { label: 'Roll', value: formatCanonical(attitude.rollRad, 'rad', 1) },
    { label: 'Pitch', value: formatCanonical(attitude.pitchRad, 'rad', 1) },
    { label: 'Yaw', value: formatCanonical(attitude.yawRad, 'rad', 1) },
  ];
});

/** Which axis is responsible for there being no attitude — named, not merely absent. */
const missing = computed(() =>
  Object.values(ATTITUDE_SIGNAL_IDS)
    .map((id) => ({ id, channel: props.playback?.channels.get(id) }))
    .filter((entry) => !channelIsUsable(entry.channel)),
);
</script>

<template>
  <section class="attitude" aria-labelledby="attitude-heading">
    <h2 id="attitude-heading">Attitude</h2>

    <svg
      v-if="glyph"
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      class="canvas"
      role="img"
      aria-label="Vehicle attitude"
    >
      <line
        :x1="glyph.horizon[0].x"
        :y1="glyph.horizon[0].y"
        :x2="glyph.horizon[1].x"
        :y2="glyph.horizon[1].y"
        class="horizon"
      />
      <line
        v-for="(edge, index) in glyph.edges"
        :key="index"
        :x1="edge[0].x"
        :y1="edge[0].y"
        :x2="edge[1].x"
        :y2="edge[1].y"
        class="member"
      />
    </svg>

    <div v-else class="absent">
      <p>No attitude at this instant.</p>
      <ul>
        <li v-for="entry in missing" :key="entry.id">
          <span class="mono">{{ entry.id }}</span>
          <span class="reason">
            {{ entry.channel ? VALIDITY_MEANING[entry.channel.validity] : 'not logged' }}
          </span>
        </li>
      </ul>
    </div>

    <dl v-if="axes.length > 0" class="readout">
      <div v-for="axis in axes" :key="axis.label">
        <dt>{{ axis.label }}</dt>
        <dd class="mono">{{ axis.value.text }} {{ axis.value.unit }}</dd>
      </div>
    </dl>
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
  max-width: 220px;
  aspect-ratio: 1;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.horizon {
  stroke: var(--border-strong);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.member {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.absent {
  border: 1px dashed var(--border-strong);
  border-radius: 3px;
  padding: 0.75rem;
  font-size: 0.78rem;
  color: var(--warn);
}

.absent p {
  margin: 0 0 0.4rem;
}

.absent ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.15rem;
  color: var(--fg-dim);
  font-size: 0.72rem;
}

.absent li {
  display: flex;
  gap: 0.5rem;
}

.readout {
  display: flex;
  gap: 1rem;
  margin: 0.5rem 0 0;
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
  font-size: 0.8rem;
}

.mono {
  font-family: var(--mono);
}

.reason {
  color: var(--fg-dim);
}
</style>
