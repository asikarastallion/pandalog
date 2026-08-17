<script setup lang="ts">
/**
 * Summary — what this flight is, and what the analysis concluded overall.
 *
 * The landing point of a workspace. It states the shape of the flight and the headline outcome, and
 * every count on it is a link into the view that explains it: a summary that cannot be drilled into
 * is a summary somebody has to take on trust.
 */
import { computed } from 'vue';

import EventTimeline from '../components/EventTimeline.vue';
import FlightSummary from '../components/FlightSummary.vue';
import type { PipelineResult } from '@pandalog/pipeline';
import type { TimeWindow } from '@pandalog/query';
import type { ViewId } from '../workspace/navigation.js';

const props = defineProps<{
  result: PipelineResult;
  flightWindow: TimeWindow | null;
}>();

const emit = defineEmits<{ show: [view: ViewId] }>();

const summary = computed(() => props.result.verification.summary);

const outcomes = computed(() => [
  { label: 'PASS', count: summary.value.PASS, tone: 'pass' },
  { label: 'FAIL', count: summary.value.FAIL, tone: 'fail' },
  { label: 'INCONCLUSIVE', count: summary.value.INCONCLUSIVE, tone: 'open' },
  { label: 'NOT_APPLICABLE', count: summary.value.NOT_APPLICABLE, tone: 'na' },
]);

const severities = computed(() => {
  const counts = new Map<string, number>();
  for (const finding of props.result.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  return [...counts.entries()].sort();
});
</script>

<template>
  <div class="summary-view">
    <FlightSummary :result="result" />

    <section class="headline" aria-labelledby="verdict-heading">
      <h3 id="verdict-heading">Verification</h3>
      <!--
        Four outcomes, four figures, always shown even at zero. Hiding an empty INCONCLUSIVE would
        make "nothing was inconclusive" indistinguishable from "inconclusive was never considered".
      -->
      <ul class="outcomes">
        <li v-for="outcome in outcomes" :key="outcome.label" :class="outcome.tone">
          <button type="button" @click="emit('show', 'verification')">
            <span class="count">{{ outcome.count }}</span>
            <span class="label">{{ outcome.label }}</span>
          </button>
        </li>
      </ul>
      <p class="caveat">
        Every criterion behind these outcomes is provisional — none traces to a flight-test
        document, so a PASS means a placeholder criterion was met.
      </p>
    </section>

    <section class="headline" aria-labelledby="findings-heading">
      <h3 id="findings-heading">Findings</h3>
      <p v-if="result.findings.length === 0" class="none">
        No registered rule found a condition it was written to detect. That is not a statement that
        nothing was wrong.
      </p>
      <ul v-else class="severities">
        <li v-for="[severity, count] in severities" :key="severity">
          <button type="button" @click="emit('show', 'investigation')">
            {{ count }} × {{ severity }}
          </button>
        </li>
      </ul>
    </section>

    <section class="headline" aria-labelledby="timeline-heading">
      <h3 id="timeline-heading">Events</h3>
      <EventTimeline
        v-if="flightWindow"
        :events="result.events"
        :window="flightWindow"
        :highlight="null"
      />
      <p v-else class="none">This flight has no time extent to place events on.</p>
    </section>
  </div>
</template>

<style scoped>
.summary-view {
  display: grid;
  gap: 1.25rem;
  max-width: 56rem;
}

h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0 0 0.5rem;
}

.outcomes,
.severities {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.outcomes button,
.severities button {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.55rem 0.8rem;
  color: inherit;
  font: inherit;
  cursor: pointer;
  display: grid;
  gap: 0.15rem;
  text-align: left;
}

.outcomes button:hover,
.severities button:hover {
  border-color: var(--accent);
}

.count {
  font-size: 1.15rem;
  font-family: var(--mono);
}

.label {
  font-size: 0.66rem;
  letter-spacing: 0.05em;
  color: var(--fg-dim);
}

.pass .count {
  color: var(--pass);
}
.fail .count {
  color: var(--fail);
}
.open .count {
  color: var(--warn);
}

.caveat,
.none {
  margin: 0.6rem 0 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--fg-dim);
  max-width: 48rem;
}

.severities button {
  font-size: 0.8rem;
}
</style>
