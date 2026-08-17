<script setup lang="ts">
/**
 * The findings a flight produced, in flight order.
 *
 * Selecting one is the entry point to the investigation workflow (doc 03 §5). The empty state is
 * worded carefully: no findings means the rules that ran raised nothing, which is not the same as
 * the flight being sound, and the panel says so rather than showing a reassuring tick.
 */
import type { FindingAtTime } from '../workspace/investigation.js';
import { formatSeconds } from '../workspace/format.js';

defineProps<{
  findings: readonly FindingAtTime[];
  selectedId: string | null;
  notApplicableRuleIds: readonly string[];
}>();

const emit = defineEmits<{ select: [findingId: string] }>();
</script>

<template>
  <section class="findings" aria-labelledby="findings-heading">
    <h2 id="findings-heading">Findings</h2>

    <p v-if="findings.length === 0" class="empty">
      No rule raised a finding. That means the rules that ran found nothing above their criteria —
      not that the flight was without fault.
    </p>

    <ul v-else class="list">
      <li v-for="entry in findings" :key="entry.finding.id">
        <button
          type="button"
          class="entry"
          :class="{ selected: entry.finding.id === selectedId }"
          :aria-current="entry.finding.id === selectedId ? 'true' : undefined"
          @click="emit('select', entry.finding.id)"
        >
          <span class="severity" :class="entry.finding.severity.toLowerCase()">
            {{ entry.finding.severity }}
          </span>
          <span class="statement">{{ entry.finding.statement }}</span>
          <span class="meta">
            <span class="time">{{ formatSeconds(entry.startSeconds) }}</span>
            <span class="rule">{{ entry.finding.ruleId }}</span>
          </span>
        </button>
      </li>
    </ul>

    <p v-if="notApplicableRuleIds.length > 0" class="not-applicable">
      Did not apply to this flight:
      <span v-for="ruleId in notApplicableRuleIds" :key="ruleId" class="rule">{{ ruleId }}</span>
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

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.entry {
  width: 100%;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 3px;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
  display: grid;
  gap: 0.25rem;
  color: inherit;
  font: inherit;
}

.entry:hover {
  border-color: var(--accent-dim);
}

.entry.selected {
  border-left-color: var(--accent);
  background: var(--surface-raised);
}

.severity {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.severity.critical {
  color: var(--fail);
}
.severity.warning {
  color: var(--warn);
}
.severity.advisory,
.severity.info {
  color: var(--fg-dim);
}

.statement {
  font-size: 0.85rem;
  line-height: 1.4;
}

.meta {
  display: flex;
  gap: 0.6rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.empty,
.not-applicable {
  font-size: 0.8rem;
  color: var(--fg-dim);
  line-height: 1.5;
}

.not-applicable .rule {
  font-family: var(--mono);
  margin-left: 0.4rem;
}
</style>
