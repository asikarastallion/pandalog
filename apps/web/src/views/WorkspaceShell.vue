<script setup lang="ts">
/**
 * The workspace frame — doc 01 §5.1.
 *
 * A persistent navigation rail and exactly one active view. The rail is the contract made visible:
 * each entry is a question the product answers, and a new capability becomes an entry or extends
 * the one whose question it belongs to, rather than being appended to whichever page had room.
 *
 * The clock and the selection live in the store, not here, so switching view never resets them —
 * a finding opened in Investigation is the same instant the 3D view is showing (§5.1 rule 3).
 */
import { computed } from 'vue';

import { VIEWS, type ViewId } from '../workspace/navigation.js';

const props = defineProps<{
  activeView: ViewId;
  fileName: string;
  findingCount: number;
  failCount: number;
}>();

const emit = defineEmits<{
  show: [view: ViewId];
  close: [];
}>();

const active = computed(() => VIEWS.find((view) => view.id === props.activeView) ?? VIEWS[0]);

/** A count worth surfacing on the rail itself, so it is visible from every other view. */
const badgeFor = (id: ViewId): number | null => {
  if (id === 'investigation') {
    return props.findingCount > 0 ? props.findingCount : null;
  }
  if (id === 'verification') {
    return props.failCount > 0 ? props.failCount : null;
  }
  return null;
};
</script>

<template>
  <div class="workspace">
    <nav class="rail" aria-label="Workspace views">
      <button type="button" class="close" @click="emit('close')">
        <span aria-hidden="true">←</span>
        <span class="rail-label">All logs</span>
      </button>

      <p class="file" :title="fileName">{{ fileName }}</p>

      <ul>
        <li v-for="view in VIEWS" :key="view.id">
          <button
            type="button"
            class="tab"
            :class="{ current: view.id === activeView }"
            :aria-current="view.id === activeView ? 'page' : undefined"
            :title="view.question"
            @click="emit('show', view.id)"
          >
            <span class="glyph" aria-hidden="true">{{ view.glyph }}</span>
            <span class="rail-label">{{ view.label }}</span>
            <span
              v-if="badgeFor(view.id) !== null"
              class="badge"
              :class="{ alarm: view.id === 'verification' }"
            >
              {{ badgeFor(view.id) }}
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <main class="stage">
      <header class="stage-head">
        <h2>{{ active?.label }}</h2>
        <!-- The view's question, shown rather than implied: it is what stops this becoming a page. -->
        <p>{{ active?.question }}</p>
      </header>

      <div class="stage-body">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
  min-height: calc(100vh - 3.2rem);
}

.rail {
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 0.75rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.close {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: var(--fg-dim);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0.3rem 0.4rem;
  border-radius: 3px;
}

.close:hover {
  color: var(--accent);
}

.file {
  margin: 0 0 0.3rem;
  padding: 0 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.15rem;
}

.tab {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--fg-dim);
  font: inherit;
  font-size: 0.82rem;
  text-align: left;
  padding: 0.4rem 0.45rem;
  cursor: pointer;
}

.tab:hover {
  color: var(--fg);
  background: var(--surface-raised);
}

.tab.current {
  color: var(--fg);
  background: var(--surface-raised);
  border-color: var(--accent-dim);
}

.glyph {
  width: 1.1rem;
  text-align: center;
  font-size: 0.9rem;
}

.badge {
  margin-left: auto;
  font-size: 0.66rem;
  font-family: var(--mono);
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--fg-dim);
}

.badge.alarm {
  color: var(--fail);
  border-color: var(--fail);
}

.stage {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.stage-head {
  padding: 0.9rem 1.25rem 0.7rem;
  border-bottom: 1px solid var(--border);
}

.stage-head h2 {
  margin: 0;
  font-size: 1rem;
}

.stage-head p {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: var(--fg-dim);
}

.stage-body {
  flex: 1;
  min-width: 0;
  padding: 1.1rem 1.25rem 2rem;
}

@media (max-width: 60rem) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .rail {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .rail ul {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    overflow-x: auto;
  }

  .rail-label {
    display: none;
  }

  .file {
    display: none;
  }
}
</style>
