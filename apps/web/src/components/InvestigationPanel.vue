<script setup lang="ts">
/**
 * Finding → Evidence → Time Window → Synchronized Signals → Context (doc 03 §5).
 *
 * The whole chain in one pane. Three things are deliberate:
 *
 *   Every threshold shows its `basis`. A criterion marked `provisional` is displayed as such, so a
 *   reader cannot mistake a placeholder for a qualified limit (doc 03 §4).
 *
 *   Evidence that failed to resolve is shown, not hidden. An investigation quietly displaying less
 *   than the finding cited would let someone conclude from a partial view without knowing it.
 *
 *   The shaded band is what the evidence covers; the rest is context padding. The difference is
 *   visible because the claim and the surroundings are not the same thing.
 */
import type { Investigation } from '../workspace/investigation.js';
import { formatQuantity, formatSeconds, formatWindow } from '../workspace/format.js';
import SignalPlot from './SignalPlot.vue';

defineProps<{
  investigation: Investigation | null;
  availableSignalIds: readonly string[];
  extraSignalIds: readonly string[];
}>();

const emit = defineEmits<{ toggleSignal: [signalId: string] }>();
</script>

<template>
  <section class="investigation" aria-labelledby="investigation-heading">
    <h2 id="investigation-heading">Investigation</h2>

    <p v-if="investigation === null" class="empty">Select a finding to open its evidence.</p>

    <template v-else>
      <p class="statement">{{ investigation.finding.statement }}</p>

      <dl class="attributes">
        <div>
          <dt>Rule</dt>
          <dd class="mono">
            {{ investigation.finding.ruleId }} v{{ investigation.finding.ruleVersion }}
          </dd>
        </div>
        <div>
          <dt>Evidence window</dt>
          <dd class="mono">
            {{
              formatWindow(
                investigation.evidenceWindow.startSeconds,
                investigation.evidenceWindow.endSeconds,
              )
            }}
          </dd>
        </div>
      </dl>

      <div v-if="investigation.finding.measurements.length > 0" class="quantities">
        <h3>Measurements</h3>
        <ul>
          <li v-for="measurement in investigation.finding.measurements" :key="measurement.label">
            <span>{{ measurement.label }}</span>
            <span class="mono">
              {{ formatQuantity(measurement.value, measurement.unit).text }}
              {{ formatQuantity(measurement.value, measurement.unit).unit }}
            </span>
          </li>
        </ul>
      </div>

      <div v-if="investigation.finding.thresholds.length > 0" class="quantities">
        <h3>Criteria</h3>
        <ul>
          <li v-for="threshold in investigation.finding.thresholds" :key="threshold.label">
            <span>{{ threshold.label }}</span>
            <span class="mono">
              {{ formatQuantity(threshold.value, threshold.unit).text }}
              {{ formatQuantity(threshold.value, threshold.unit).unit }}
            </span>
            <span class="basis" :class="{ provisional: threshold.basis === 'provisional' }">
              {{ threshold.basis }}
            </span>
          </li>
        </ul>
      </div>

      <SignalPlot
        :signals="investigation.signals"
        :window="investigation.window"
        :evidence-window="investigation.evidenceWindow"
        :events="investigation.citedEvents"
      />

      <div v-if="investigation.citedEvents.length > 0" class="cited">
        <h3>Events cited</h3>
        <ul>
          <li v-for="event in investigation.citedEvents" :key="event.id">
            <span class="mono">{{ event.type }}</span>
            <span class="mono dim">
              {{ formatSeconds(event.t_start_seconds) }}
              <template v-if="event.t_end_seconds !== null">
                → {{ formatSeconds(event.t_end_seconds) }}
              </template>
            </span>
          </li>
        </ul>
      </div>

      <p v-if="investigation.unresolvedSignalIds.length > 0" class="unresolved">
        Cited but not present in this dataset:
        <span v-for="id in investigation.unresolvedSignalIds" :key="id" class="mono">{{ id }}</span>
      </p>

      <p v-if="investigation.unresolvedEvidence.length > 0" class="unresolved">
        {{ investigation.unresolvedEvidence.length }} evidence reference(s) could not be resolved.
        This view is showing less than the finding cited.
      </p>

      <details class="context">
        <summary>Add context signals</summary>
        <ul class="signal-picker">
          <li v-for="signalId in availableSignalIds" :key="signalId">
            <label>
              <input
                type="checkbox"
                :checked="extraSignalIds.includes(signalId)"
                @change="emit('toggleSignal', signalId)"
              />
              <span class="mono">{{ signalId }}</span>
            </label>
          </li>
        </ul>
      </details>
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

h3 {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
  margin: 0 0 0.25rem;
}

.statement {
  font-size: 0.95rem;
  line-height: 1.5;
  margin: 0 0 0.75rem;
}

.attributes {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin: 0 0 0.75rem;
}

.attributes div {
  display: grid;
  gap: 0.15rem;
}

dt {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
}

dd {
  margin: 0;
  font-size: 0.8rem;
}

.quantities {
  margin-bottom: 0.75rem;
}

.quantities ul,
.cited ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.2rem;
}

.quantities li,
.cited li {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  font-size: 0.8rem;
}

.quantities li span:first-child {
  min-width: 14rem;
  color: var(--fg-dim);
}

.basis {
  font-size: 0.65rem;
  font-family: var(--mono);
  color: var(--fg-dim);
}

.basis.provisional {
  color: var(--warn);
}

.cited {
  margin-top: 0.75rem;
}

.mono {
  font-family: var(--mono);
}

.dim {
  color: var(--fg-dim);
}

.unresolved {
  font-size: 0.8rem;
  color: var(--warn);
  line-height: 1.5;
}

.unresolved .mono {
  margin-left: 0.4rem;
}

.context {
  margin-top: 1rem;
  font-size: 0.8rem;
}

.context summary {
  cursor: pointer;
  color: var(--fg-dim);
}

.signal-picker {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.2rem;
}

.signal-picker label {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  cursor: pointer;
  font-size: 0.75rem;
}

.empty {
  color: var(--fg-dim);
  font-size: 0.85rem;
}
</style>
