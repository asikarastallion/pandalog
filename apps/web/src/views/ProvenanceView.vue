<script setup lang="ts">
/**
 * Log info — what exactly was analysed, by what, at which versions.
 *
 * Doc 04 §7 requires every report to embed provenance so two runs can be shown to be the same run.
 * That record existed only inside the exported document, which meant the answer to "is this the
 * same log I looked at yesterday" was reachable only by exporting a report and reading its header.
 *
 * Everything here is `@pandalog/reporting`'s `buildReport` output — the same provenance block the
 * document carries, rendered on screen instead of in a file, so the two cannot disagree.
 */
import { computed } from 'vue';

import { buildReport } from '@pandalog/reporting';
import type { PipelineResult } from '@pandalog/pipeline';

import { formatBytes, formatSeconds } from '../workspace/format.js';

const props = defineProps<{
  result: PipelineResult;
  flightWindow: { readonly startSeconds: number; readonly endSeconds: number } | null;
}>();

/**
 * The clock is irrelevant here — nothing on this screen is the generation timestamp — but
 * `buildReport` requires one, and a fixed instant keeps the computed stable across reactive reads.
 */
const document_ = computed(() =>
  buildReport({
    ...props.result,
    now: () => new Date(props.result.dataset.provenance.ingestedAtUtc),
  }),
);

const provenance = computed(() => document_.value.provenance);

/** A value the log did not carry, named rather than blanked (doc 04 §1 rule 6). */
const orNotLogged = (value: string | null): string => value ?? 'not logged';

const signalCount = computed(() => props.result.dataset.signals.size);
</script>

<template>
  <div class="provenance-view">
    <section aria-labelledby="source-heading">
      <h3 id="source-heading">Source</h3>
      <dl class="facts">
        <dt>File</dt>
        <dd class="mono">{{ provenance.source.fileName }}</dd>

        <dt>SHA-256</dt>
        <!--
          Full, not truncated. This is the identity of the bytes, and a shortened hash is a hash
          nobody can check against another machine.
        -->
        <dd class="mono break">{{ provenance.source.sha256 }}</dd>

        <dt>Size</dt>
        <dd>{{ formatBytes(provenance.source.sizeBytes) }}</dd>

        <dt>Format</dt>
        <dd class="mono">{{ provenance.source.format }}</dd>

        <dt>Ingested</dt>
        <dd class="mono">{{ provenance.source.ingestedAtUtc }}</dd>
      </dl>
    </section>

    <section aria-labelledby="vehicle-heading">
      <h3 id="vehicle-heading">Vehicle</h3>
      <dl class="facts">
        <dt>Frame class</dt>
        <dd class="mono">{{ orNotLogged(provenance.vehicle.frameClass) }}</dd>

        <dt>Firmware</dt>
        <dd class="mono">{{ orNotLogged(provenance.vehicle.firmwareVersion) }}</dd>

        <dt>Firmware hash</dt>
        <dd class="mono break">{{ orNotLogged(provenance.vehicle.firmwareHash) }}</dd>
      </dl>
      <p class="note">
        Where these read <em>not logged</em>, the log did not record them — they are not defaults.
        Frame class is why a flight mode is shown here as a number and never as a name: mode 5 is
        LOITER on a multirotor and FBWA on a fixed wing, and without the airframe there is no way to
        tell which, so naming it would be a guess a reader could not detect.
      </p>
    </section>

    <section aria-labelledby="versions-heading">
      <h3 id="versions-heading">Versions</h3>
      <dl class="facts">
        <dt>Parser</dt>
        <dd class="mono">
          {{ provenance.source.parserPackage }} {{ provenance.source.parserVersion }}
        </dd>

        <dt>Canonical model</dt>
        <dd class="mono">{{ provenance.schemaVersion }}</dd>

        <dt>Reporting</dt>
        <dd class="mono">{{ provenance.reportingVersion }}</dd>

        <dt>Requirement set</dt>
        <dd class="mono">
          {{ provenance.requirementSet.id }} {{ provenance.requirementSet.version }} (source
          {{ provenance.requirementSet.source }})
        </dd>
      </dl>
    </section>

    <section aria-labelledby="rules-heading">
      <h3 id="rules-heading">Rules applied</h3>
      <table class="rules">
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Version</th>
            <th scope="col">Applied to this flight</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in provenance.rules" :key="rule.id">
            <th scope="row" class="mono">{{ rule.id }}</th>
            <td class="mono">{{ rule.version }}</td>
            <td>{{ rule.applied ? 'yes' : 'no' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        A rule that applied and found nothing is not the same as a rule that did not apply; both are
        listed so this says what the flight was actually checked against.
      </p>
    </section>

    <section aria-labelledby="contents-heading">
      <h3 id="contents-heading">What the log contained</h3>
      <dl class="facts">
        <dt>Signals</dt>
        <dd>{{ signalCount }}</dd>

        <dt>Events detected</dt>
        <dd>{{ result.events.length }}</dd>

        <dt>Extent</dt>
        <dd>
          <span v-if="flightWindow">
            {{ formatSeconds(flightWindow.startSeconds) }} to
            {{ formatSeconds(flightWindow.endSeconds) }}
          </span>
          <span v-else>no signal carries a sample, so this flight has no time extent</span>
        </dd>
      </dl>
    </section>

    <p class="note">
      This is the same provenance block the exported report carries, rendered here rather than in a
      file — two runs over one log at these versions produce the same analysis, and this is what
      makes that checkable.
    </p>
  </div>
</template>

<style scoped>
.provenance-view {
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

.facts {
  display: grid;
  grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
  gap: 0.3rem 1rem;
  margin: 0;
  font-size: 0.82rem;
}

.facts dt {
  color: var(--fg-dim);
}

.facts dd {
  margin: 0;
}

.mono {
  font-family: var(--mono);
  font-size: 0.78rem;
}

.break {
  word-break: break-all;
}

.rules {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.rules th,
.rules td {
  border: 1px solid var(--border);
  padding: 0.35rem 0.5rem;
  text-align: left;
}

.rules thead th {
  background: var(--surface-raised);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-dim);
}

.note {
  margin: 0.6rem 0 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--fg-dim);
  max-width: 48rem;
}
</style>
