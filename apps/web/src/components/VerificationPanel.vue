<script setup lang="ts">
/**
 * Requirement outcomes.
 *
 * Four outcomes are shown as four outcomes. The temptation in a UI is to render a tick and a cross
 * and let INCONCLUSIVE and NOT_APPLICABLE fall into the tick — which would undo the entire point of
 * `@pandalog/verification`, in CSS. Each outcome carries its plain-language meaning alongside the
 * word, and the requirement set's provenance is stated at the top rather than buried.
 */
import type { VerificationReport } from '@pandalog/verification';

import { OUTCOME_MEANING, outcomeTone } from '../workspace/format.js';

defineProps<{ report: VerificationReport }>();
</script>

<template>
  <section class="verification" aria-labelledby="verification-heading">
    <h2 id="verification-heading">Verification</h2>

    <p class="provenance">
      <span class="mono">{{ report.requirementSetId }} v{{ report.requirementSetVersion }}</span>
      <span class="source" :class="{ provisional: report.requirementSetSource === 'provisional' }">
        source: {{ report.requirementSetSource }}
      </span>
    </p>
    <p v-if="report.requirementSetSource === 'provisional'" class="caveat">
      These criteria are provisional — none traces to a flight-test document. A PASS means a
      placeholder criterion was met, and is not qualification evidence.
    </p>

    <ul class="results">
      <li v-for="result in report.results" :key="result.requirementId">
        <div class="head">
          <span class="outcome" :class="outcomeTone(result.outcome)">{{ result.outcome }}</span>
          <span class="mono id">{{ result.requirementId }}</span>
          <span class="meaning">{{ OUTCOME_MEANING[result.outcome] }}</span>
        </div>
        <p class="reason">{{ result.reason }}</p>
        <p class="evidence-count">
          {{ result.evidence.length }} evidence reference{{
            result.evidence.length === 1 ? '' : 's'
          }}
        </p>
      </li>
    </ul>

    <p v-if="report.evidenceRuleViolations.length > 0" class="violation">
      {{ report.evidenceRuleViolations.length }} requirement(s) reported a verdict without citing
      evidence and were recorded INCONCLUSIVE. That is a defect in the requirement, not in the
      flight.
    </p>
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

.provenance {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  font-size: 0.75rem;
  margin: 0 0 0.25rem;
}

.source {
  color: var(--fg-dim);
}

.source.provisional {
  color: var(--warn);
}

.caveat {
  font-size: 0.75rem;
  color: var(--warn);
  line-height: 1.5;
  margin: 0 0 0.75rem;
}

.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.results li {
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0.5rem 0.6rem;
  background: var(--surface);
}

.head {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  flex-wrap: wrap;
}

.outcome {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0.1rem 0.35rem;
  border-radius: 2px;
  border: 1px solid currentColor;
}

.outcome.pass {
  color: var(--pass);
}
.outcome.fail {
  color: var(--fail);
}
.outcome.inconclusive {
  color: var(--warn);
}
.outcome.not_applicable {
  color: var(--fg-dim);
}

.id {
  font-size: 0.8rem;
}

.meaning {
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.reason {
  font-size: 0.78rem;
  line-height: 1.5;
  margin: 0.35rem 0 0;
  color: var(--fg);
}

.evidence-count {
  font-size: 0.7rem;
  color: var(--fg-dim);
  margin: 0.25rem 0 0;
  font-family: var(--mono);
}

.violation {
  font-size: 0.78rem;
  color: var(--fail);
  line-height: 1.5;
}

.mono {
  font-family: var(--mono);
}
</style>
