<script setup lang="ts">
/**
 * What was loaded, and what the tool did with it.
 *
 * The SHA-256 is shown because a verification result that cannot be tied to a specific file is an
 * assertion about "some flight" (doc 02 §2 provenance). Vehicle fields render as an em dash when
 * the log did not state them — the parser never guesses, and neither does this.
 */
import type { PipelineResult } from '@pandalog/pipeline';

import { ABSENT, formatBytes } from '../workspace/format.js';

defineProps<{ result: PipelineResult }>();
</script>

<template>
  <section class="summary" aria-labelledby="summary-heading">
    <h2 id="summary-heading">Flight</h2>

    <dl>
      <div>
        <dt>Log</dt>
        <dd class="mono">{{ result.dataset.provenance.fileName }}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd class="mono">{{ formatBytes(result.dataset.provenance.sizeBytes) }}</dd>
      </div>
      <div>
        <dt>Format</dt>
        <dd class="mono">{{ result.dataset.provenance.format }}</dd>
      </div>
      <div>
        <dt>Frame</dt>
        <dd class="mono">{{ result.dataset.vehicle.frameClass ?? ABSENT }}</dd>
      </div>
      <div>
        <dt>Firmware</dt>
        <dd class="mono">{{ result.dataset.vehicle.firmwareVersion ?? ABSENT }}</dd>
      </div>
      <div>
        <dt>Time base</dt>
        <dd class="mono">{{ result.dataset.timeBase.origin }}</dd>
      </div>
    </dl>

    <p class="counts">
      <span>{{ result.dataset.signals.size }} signals</span>
      <span>{{ result.events.length }} events</span>
      <span>{{ result.findings.length }} findings</span>
      <span>{{ result.hypotheses.length }} hypotheses</span>
    </p>

    <p class="digest mono" :title="result.dataset.provenance.sha256">
      sha256 {{ result.dataset.provenance.sha256.slice(0, 16) }}…
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

dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0 0 0.6rem;
}

dl div {
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
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--fg-dim);
  margin: 0 0 0.35rem;
}

.digest {
  font-size: 0.68rem;
  color: var(--fg-dim);
  margin: 0;
}

.mono {
  font-family: var(--mono);
}
</style>
