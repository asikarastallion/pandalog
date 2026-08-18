<script setup lang="ts">
/**
 * Comparison — how this flight differed from another, and where it cannot be compared.
 *
 * `@pandalog/comparison` shipped complete in Phase J and was reachable from nowhere. This is its
 * first surface (ADR-0016 amendment). The view computes nothing: `workspace/comparison.ts` runs the
 * package's own `compareFlights` and this renders the result.
 *
 * **`INCOMPARABLE` is shown as itself**, in its own colour, never folded into "no difference".
 * ADR-0012 makes it a third answer for the same reason `INCONCLUSIVE` is one in verification: the
 * ways a cross-flight comparison fails are quiet — mismatched time origins, a unit that changed,
 * windows that never overlap, two reports answering different requirement sets — and under a
 * boolean every one of them looks like a clean result. This is the one place a person reads that
 * verdict, so it is the one place collapsing it would actually mislead somebody.
 */
import { computed, ref } from 'vue';

import { comparisonAxes, type ComparisonState } from '../workspace/comparison.js';
import { formatSeconds } from '../workspace/format.js';
import type { StoredLogSummary } from '../workspace/persistence.js';

const props = defineProps<{
  candidates: readonly StoredLogSummary[];
  state: ComparisonState;
  storageAvailable: boolean;
}>();

const emit = defineEmits<{ compare: [sha256: string] }>();

const chosen = ref<string>('');

const axes = computed(() =>
  props.state.status === 'ready' ? comparisonAxes(props.state.report) : [],
);

const tone = (verdict: string): string =>
  verdict === 'SAME' ? 'same' : verdict === 'DIFFERENT' ? 'different' : 'incomparable';

const run = (): void => {
  if (chosen.value.length > 0) {
    emit('compare', chosen.value);
  }
};
</script>

<template>
  <div class="comparison-view">
    <section class="picker" aria-labelledby="baseline-heading">
      <h3 id="baseline-heading">Baseline</h3>

      <p v-if="!storageAvailable" class="note">
        This browser will not allow local storage, so there is no second log here to compare
        against. Analysis of the open log is unaffected.
      </p>

      <p v-else-if="candidates.length === 0" class="note">
        No other log is stored in this browser. Open a second log from the landing page and it
        becomes available here — comparison needs two flights, and comparing a flight against itself
        is a self-consistency check rather than a question worth asking.
      </p>

      <div v-else class="controls">
        <label class="field">
          <span class="visually-hidden">Baseline log</span>
          <select v-model="chosen">
            <option value="" disabled>Choose a log to compare against…</option>
            <option v-for="entry in candidates" :key="entry.sha256" :value="entry.sha256">
              {{ entry.fileName }} —
              {{
                entry.durationSeconds === null ? 'no extent' : formatSeconds(entry.durationSeconds)
              }}, {{ entry.findingCount }} finding{{ entry.findingCount === 1 ? '' : 's' }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="primary"
          :disabled="chosen.length === 0 || state.status === 'running'"
          @click="run"
        >
          {{ state.status === 'running' ? 'Comparing…' : 'Compare' }}
        </button>
      </div>

      <p class="note">
        The baseline is re-analysed from its stored bytes rather than restored from a cached
        verdict, so what you see is what the code currently concludes. Nothing is uploaded.
      </p>
    </section>

    <p v-if="state.status === 'failed'" class="failure" role="alert">
      {{ state.message }}
    </p>

    <template v-if="state.status === 'ready'">
      <section class="verdict" aria-labelledby="verdict-heading">
        <h3 id="verdict-heading">Overall</h3>
        <p class="overall" :class="tone(state.report.verdict)">{{ state.report.verdict }}</p>
        <p class="note">
          <code>{{ state.report.baselineLabel }}</code> as baseline against
          <code>{{ state.report.subjectLabel }}</code
          >. Time bases were aligned on {{ state.report.alignment.basis }}.
        </p>
      </section>

      <section aria-labelledby="axes-heading">
        <h3 id="axes-heading">By axis</h3>
        <table class="axes">
          <thead>
            <tr>
              <th scope="col">Axis</th>
              <th scope="col">Verdict</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="axis in axes" :key="axis.name">
              <th scope="row">{{ axis.name }}</th>
              <td>
                <span class="tag" :class="tone(axis.verdict)">{{ axis.verdict }}</span>
              </td>
              <td class="reason">{{ axis.reason }}</td>
            </tr>
          </tbody>
        </table>
        <!--
          Stated on the screen, not only in an ADR: a reader who takes INCOMPARABLE for "no
          difference" has drawn the opposite conclusion from the one the data supports.
        -->
        <p class="note">
          <strong>INCOMPARABLE is not a pass.</strong> It means that axis could not be compared at
          all — a unit that changed, windows that never overlap, or two flights checked against
          different requirement sets. Treating it as "no difference" is the mistake this verdict
          exists to prevent.
        </p>
      </section>

      <section v-if="state.report.tolerances.length > 0" aria-labelledby="tolerance-heading">
        <h3 id="tolerance-heading">Thresholds that decided this</h3>
        <ul class="tolerances">
          <li v-for="tolerance in state.report.tolerances" :key="tolerance.label">
            {{ tolerance.label }}: {{ tolerance.value }} {{ tolerance.unit }} (basis
            <code>{{ tolerance.basis }}</code
            >)
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.comparison-view {
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

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

select {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.35rem 0.5rem;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--surface-sunken);
  color: var(--fg);
  min-width: 22rem;
  max-width: 100%;
}

button {
  font: inherit;
  font-size: 0.78rem;
  padding: 0.35rem 0.8rem;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--fg);
  cursor: pointer;
}

button.primary {
  border-color: var(--accent);
  color: var(--accent);
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.overall {
  margin: 0;
  font-family: var(--mono);
  font-size: 1.2rem;
  font-weight: 600;
}

.tag {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
  border: 1px solid currentColor;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.same {
  color: var(--pass);
}
.different {
  color: var(--warn);
}
.incomparable {
  color: var(--fail);
}

.axes {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.axes th,
.axes td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.axes thead th {
  background: var(--surface-raised);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-dim);
}

.reason {
  line-height: 1.5;
}

.failure {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--fail);
  border-radius: 4px;
  color: var(--fail);
  font-size: 0.82rem;
  line-height: 1.5;
}

.tolerances {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  line-height: 1.7;
  color: var(--fg-dim);
}

.note {
  margin: 0.6rem 0 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--fg-dim);
  max-width: 48rem;
}

code {
  font-family: var(--mono);
}
</style>
