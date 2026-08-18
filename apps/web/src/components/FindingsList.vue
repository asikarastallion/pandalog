<script setup lang="ts">
/**
 * The findings a flight produced — grouped, filterable, and searchable.
 *
 * Selecting one is the entry point to the investigation workflow (doc 03 §5). What changed from a
 * flat list is why: a real log raised 43 findings, twenty-odd of them one rule restating one
 * sentence with different numbers, and a list of 43 rows is a list an engineer scrolls past. An
 * unread finding informs nobody, which is not a smaller failure than a wrong one.
 *
 * The grouping is `@pandalog/reporting`'s, reached through `workspace/findings.ts` — the same rule
 * the report uses, so what is found here has the same shape in the document. The component computes
 * nothing (doc 04 §1 rule 1): it holds the filter, which is UI state, and renders what
 * `browseFindings` returns.
 *
 * The empty state is worded carefully in both of its forms. No findings means the rules that ran
 * raised nothing, which is not the same as the flight being sound; no *matches* means the filter is
 * hiding things, and the count says how many.
 */
import { computed, ref } from 'vue';

import type { Severity } from '@pandalog/analysis';

import {
  browseFindings,
  NO_FILTER,
  toggleRuleId,
  toggleSeverity,
  withQuery,
  type FindingFilter,
} from '../workspace/findings.js';
import type { FindingAtTime } from '../workspace/investigation.js';
import { formatSeconds } from '../workspace/format.js';

const props = defineProps<{
  findings: readonly FindingAtTime[];
  selectedId: string | null;
  notApplicableRuleIds: readonly string[];
}>();

const emit = defineEmits<{ select: [findingId: string] }>();

/** Filter state is the operator's view of the data, never the data — doc 01 §5.1 rule 5. */
const filter = ref<FindingFilter>(NO_FILTER);

const browse = computed(() => browseFindings(props.findings, filter.value));

/** Groups the operator has collapsed. Repeated groups start collapsed; singletons have no body. */
const collapsed = ref<ReadonlySet<string>>(new Set());

const isCollapsed = (key: string, count: number): boolean =>
  count > 1 && !collapsed.value.has(`open:${key}`);

function toggleGroup(key: string): void {
  const next = new Set(collapsed.value);
  const marker = `open:${key}`;
  if (next.has(marker)) {
    next.delete(marker);
  } else {
    next.add(marker);
  }
  collapsed.value = next;
}

const clear = (): void => {
  filter.value = NO_FILTER;
};

const onSeverity = (severity: Severity): void => {
  filter.value = toggleSeverity(filter.value, severity);
};

const onRule = (ruleId: string): void => {
  filter.value = toggleRuleId(filter.value, ruleId);
};

const onQuery = (event: Event): void => {
  filter.value = withQuery(filter.value, (event.target as HTMLInputElement).value);
};

/** Short label for a group heading: the rule without its `analysis:` prefix. */
const shortRule = (ruleId: string): string => ruleId.replace(/^analysis:/, '');
</script>

<template>
  <section class="findings" aria-labelledby="findings-heading">
    <div class="head">
      <h2 id="findings-heading">Findings</h2>
      <!--
        Both numbers, always. A filtered list showing only its own count would read as the whole
        set, which is the reader being unable to tell that something is absent.
      -->
      <p class="tally">
        <span v-if="browse.isFiltered">
          {{ browse.matchCount }} of {{ browse.totalCount }} shown
        </span>
        <span v-else>{{ browse.totalCount }} total</span>
      </p>
    </div>

    <div v-if="findings.length > 0" class="controls">
      <label class="search">
        <span class="visually-hidden">Search findings</span>
        <input
          type="search"
          placeholder="Search statement, rule or signal…"
          :value="filter.query"
          @input="onQuery"
        />
      </label>

      <div class="chips" role="group" aria-label="Filter by severity">
        <button
          v-for="severity in browse.availableSeverities"
          :key="severity"
          type="button"
          class="chip"
          :class="[severity.toLowerCase(), { on: filter.severities.includes(severity) }]"
          :aria-pressed="filter.severities.includes(severity)"
          @click="onSeverity(severity)"
        >
          {{ severity }}
        </button>
      </div>

      <div class="chips" role="group" aria-label="Filter by rule">
        <button
          v-for="ruleId in browse.availableRuleIds"
          :key="ruleId"
          type="button"
          class="chip rule-chip"
          :class="{ on: filter.ruleIds.includes(ruleId) }"
          :aria-pressed="filter.ruleIds.includes(ruleId)"
          :title="ruleId"
          @click="onRule(ruleId)"
        >
          {{ shortRule(ruleId) }}
        </button>
      </div>

      <button v-if="browse.isFiltered" type="button" class="clear" @click="clear">
        Clear filter
      </button>
    </div>

    <p v-if="findings.length === 0" class="empty">
      No rule raised a finding. That means the rules that ran found nothing above their criteria —
      not that the flight was without fault.
    </p>

    <p v-else-if="browse.matchCount === 0" class="empty">
      No finding matches this filter. All {{ browse.totalCount }} are still there — clear the filter
      to see them.
    </p>

    <ul v-else class="groups">
      <li v-for="view in browse.groups" :key="view.group.key" class="group">
        <!-- A group of one is a finding; it gets no heading of its own to open. -->
        <button
          v-if="view.group.count > 1"
          type="button"
          class="group-head"
          :aria-expanded="!isCollapsed(view.group.key, view.group.count)"
          @click="toggleGroup(view.group.key)"
        >
          <span class="severity" :class="view.group.severity.toLowerCase()">
            {{ view.group.severity }}
          </span>
          <span class="group-title">{{ shortRule(view.group.ruleId) }}</span>
          <span class="group-signals">{{ view.group.signalIds.join(', ') }}</span>
          <span class="group-meta">
            <span class="count">{{ view.group.count }}×</span>
            <span v-if="view.group.firstSeconds !== null && view.group.lastSeconds !== null">
              {{ formatSeconds(view.group.firstSeconds) }} –
              {{ formatSeconds(view.group.lastSeconds) }}
            </span>
            <!--
              The largest value one of these findings recorded, not a statistic over them. It is a
              number an evidenced finding already asserted (doc 04 §7); a total would not be.
            -->
            <span v-for="peak in view.group.peaks" :key="peak.label" class="peak">
              peak {{ peak.label.toLowerCase() }} {{ peak.value }} {{ peak.unit }}
            </span>
          </span>
          <span class="chevron" aria-hidden="true">
            {{ isCollapsed(view.group.key, view.group.count) ? '▸' : '▾' }}
          </span>
        </button>

        <ul v-show="!isCollapsed(view.group.key, view.group.count)" class="list">
          <li v-for="entry in view.entries" :key="entry.finding.id">
            <button
              type="button"
              class="entry"
              :class="{ selected: entry.finding.id === selectedId, nested: view.group.count > 1 }"
              :aria-current="entry.finding.id === selectedId ? 'true' : undefined"
              @click="emit('select', entry.finding.id)"
            >
              <span v-if="view.group.count === 1" class="severity" :class="entry.finding.severity.toLowerCase()">
                {{ entry.finding.severity }}
              </span>
              <span class="statement">{{ entry.finding.statement }}</span>
              <span class="meta">
                <span class="time">{{ formatSeconds(entry.startSeconds) }}</span>
                <span v-if="view.group.count === 1" class="rule">{{ entry.finding.ruleId }}</span>
              </span>
            </button>
          </li>
        </ul>
      </li>
    </ul>

    <p v-if="notApplicableRuleIds.length > 0" class="not-applicable">
      Did not apply to this flight:
      <span v-for="ruleId in notApplicableRuleIds" :key="ruleId" class="rule">{{ ruleId }}</span>
    </p>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0;
}

.tally {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--fg-dim);
}

.controls {
  display: grid;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}

.search input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 0.78rem;
  padding: 0.35rem 0.5rem;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--surface-sunken);
  color: var(--fg);
}

.search input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.chip {
  font: inherit;
  font-size: 0.66rem;
  letter-spacing: 0.05em;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg-dim);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--accent-dim);
}

.chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--surface-raised);
}

.chip.critical.on {
  border-color: var(--fail);
  color: var(--fail);
}

.chip.warning.on {
  border-color: var(--warn);
  color: var(--warn);
}

.rule-chip {
  font-family: var(--mono);
  text-transform: none;
}

.clear {
  justify-self: start;
  font: inherit;
  font-size: 0.7rem;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0.1rem 0;
}

.groups,
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.group {
  display: grid;
  gap: 0.2rem;
}

.group-head {
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.15rem 0.5rem;
  align-items: center;
}

.group-head:hover {
  border-color: var(--accent-dim);
}

.group-title {
  font-size: 0.82rem;
  font-weight: 600;
  grid-column: 1;
}

.group-signals,
.group-meta {
  grid-column: 1;
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--fg-dim);
}

.group-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.group-meta .count {
  color: var(--fg);
  font-weight: 600;
}

.chevron {
  grid-column: 2;
  grid-row: 1 / span 4;
  color: var(--fg-dim);
  font-size: 0.7rem;
}

.severity {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  font-weight: 600;
  grid-column: 1;
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

.entry.nested {
  margin-left: 0.75rem;
  width: calc(100% - 0.75rem);
}

.entry:hover {
  border-color: var(--accent-dim);
}

.entry.selected {
  border-left-color: var(--accent);
  background: var(--surface-raised);
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
