<script setup lang="ts">
/**
 * Investigation — doc 03 §5, and the reason this product exists.
 *
 * A finding, the evidence it rests on, and the samples behind that evidence, on one screen. It was
 * previously a panel competing with six other panels for height; it is now a view, which is what
 * doc 01 §5.1 rule 2 requires of it.
 */
import FindingsList from '../components/FindingsList.vue';
import InvestigationPanel from '../components/InvestigationPanel.vue';
import type { findingsByTime, Investigation } from '../workspace/investigation.js';

defineProps<{
  findings: ReturnType<typeof findingsByTime>;
  selectedId: string | null;
  notApplicableRuleIds: readonly string[];
  investigation: Investigation | null;
  availableSignalIds: readonly string[];
  extraSignalIds: readonly string[];
}>();

const emit = defineEmits<{
  select: [findingId: string];
  toggleSignal: [signalId: string];
}>();
</script>

<template>
  <div class="investigation-view">
    <aside class="list">
      <FindingsList
        :findings="findings"
        :selected-id="selectedId"
        :not-applicable-rule-ids="notApplicableRuleIds"
        @select="emit('select', $event)"
      />
    </aside>

    <section class="detail">
      <InvestigationPanel
        v-if="investigation"
        :investigation="investigation"
        :available-signal-ids="availableSignalIds"
        :extra-signal-ids="extraSignalIds"
        @toggle-signal="emit('toggleSignal', $event)"
      />
      <p v-else class="empty">
        Select a finding to open the evidence behind it — the time window it covers, the events it
        cites, and every signal it names drawn on that window.
      </p>
    </section>
  </div>
</template>

<style scoped>
.investigation-view {
  display: grid;
  grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.empty {
  margin: 0;
  padding: 2rem 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--fg-dim);
  font-size: 0.82rem;
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 68rem) {
  .investigation-view {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
