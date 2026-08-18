<script setup lang="ts">
/**
 * The map — doc 01 §5.2, ADR-0011 (revised).
 *
 * Two modes. **Local is the default and requests nothing**: the ground track drawn in projected
 * metres with a scale bar and its bounds labelled, exactly as before. **Basemap is opt-in**, behind
 * a consent step that says what is sent and to whom.
 *
 * The consent is not a formality. A tile request's coordinates *are* the flight's location, so
 * enabling this tells a third party roughly where the aircraft flew, and when somebody looked. The
 * log, the findings and the outcomes are never sent — but "where it flew" is often the sensitive
 * part, and only the operator can weigh that.
 *
 * Leaflet is loaded by dynamic import at the moment consent is granted, so declining costs no bytes
 * and fires no request — not even for the library.
 *
 * No geography is computed here. `trackGeoSegments` and `trackGeoBoundsDegrees` invert the
 * projection through `core-domain`, so this component only hands coordinates to a library
 * (doc 04 §1 rules 1 and 7).
 */
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import GroundTrackMap from '../components/GroundTrackMap.vue';
import {
  CONSENT_DISCLOSURE,
  createConsentStore,
  mayFetchTiles,
  TILE_SOURCE,
  type BasemapConsent,
} from '../workspace/basemap.js';
import type { ModeSegment } from '@pandalog/events';

import type { PlaybackState } from '../workspace/playback.js';
import { trackGeoBoundsDegrees, trackGeoSegments, type GroundTrack } from '../workspace/track.js';

const props = defineProps<{
  track: GroundTrack | null;
  playback: PlaybackState | null;
  modes: readonly ModeSegment[];
}>();

const consentStore = createConsentStore();
const consent = ref<BasemapConsent>(consentStore.read());
const asking = ref(false);
const mapHost = shallowRef<HTMLDivElement | null>(null);
const loadFailure = ref<string | null>(null);

/** Held only so the instance can be torn down. */
let leafletMap: { remove: () => void } | null = null;

function setConsent(next: BasemapConsent): void {
  consent.value = next;
  consentStore.write(next);
  asking.value = false;
}

function onToggle(event: Event): void {
  if ((event.target as HTMLInputElement).checked) {
    // Asking, not enabling. Nothing is fetched until the disclosure has been read and accepted.
    asking.value = true;
  } else {
    setConsent('declined');
  }
}

function teardown(): void {
  leafletMap?.remove();
  leafletMap = null;
}

async function showBasemap(): Promise<void> {
  const host = mapHost.value;
  const track = props.track;
  if (host === null || track === null || track.pointCount === 0) {
    return;
  }

  const bounds = trackGeoBoundsDegrees(track);
  if (bounds === null) {
    return;
  }

  try {
    // Dynamic import: a separate chunk, never fetched unless a user opts in.
    const leaflet = await import('leaflet');
    await import('leaflet/dist/leaflet.css');

    teardown();

    const map = leaflet.map(host);
    leafletMap = map;

    leaflet
      .tileLayer(TILE_SOURCE.urlTemplate, {
        maxZoom: TILE_SOURCE.maxZoom,
        attribution: TILE_SOURCE.attributionHtml,
      })
      .addTo(map);

    // One polyline per segment, so a stretch with no fix stays a break rather than becoming a
    // straight leg across the outage — the same refusal the offline view makes.
    for (const segment of trackGeoSegments(track)) {
      if (segment.length > 1) {
        leaflet
          .polyline(
            segment.map((point) => leaflet.latLng(point.latitude, point.longitude)),
            { color: '#6ea8fe', weight: 3 },
          )
          .addTo(map);
      }
    }

    map.fitBounds(
      leaflet.latLngBounds(
        leaflet.latLng(bounds.south, bounds.west),
        leaflet.latLng(bounds.north, bounds.east),
      ),
      { padding: [24, 24], maxZoom: 17 },
    );

    loadFailure.value = null;
  } catch (error) {
    loadFailure.value = error instanceof Error ? error.message : String(error);
  }
}

watch(
  [consent, mapHost, () => props.track],
  () => {
    if (mayFetchTiles(consent.value)) {
      void showBasemap();
    } else {
      teardown();
    }
  },
  { immediate: true },
);

onBeforeUnmount(teardown);
</script>

<template>
  <div class="map-view">
    <label class="toggle">
      <input type="checkbox" :checked="consent === 'granted'" @change="onToggle" />
      <span>
        Show a real map
        <span class="dim">(sends requests to an OpenStreetMap tile server)</span>
      </span>
    </label>

    <!--
      The consent step, shown before anything is fetched: what is sent, what it reveals, what is
      *not* sent, and that it is reversible.
    -->
    <div v-if="asking" class="consent" role="dialog" aria-labelledby="consent-heading">
      <h3 id="consent-heading">Send map requests to a third party?</h3>
      <ul>
        <li>{{ CONSENT_DISCLOSURE.what }}</li>
        <li>{{ CONSENT_DISCLOSURE.why }}</li>
        <li class="reassure">{{ CONSENT_DISCLOSURE.notSent }}</li>
        <li>{{ CONSENT_DISCLOSURE.revocable }}</li>
      </ul>
      <p class="licence">
        Map data © OpenStreetMap contributors, available under the {{ TILE_SOURCE.licence }}.
      </p>
      <div class="actions">
        <button type="button" class="primary" @click="setConsent('granted')">
          Enable the basemap
        </button>
        <button type="button" @click="setConsent('declined')">Keep the offline map</button>
      </div>
    </div>

    <p v-if="loadFailure" class="failure" role="alert">
      The map library or its tiles could not be loaded: {{ loadFailure }}. The offline track below
      is unaffected.
    </p>

    <div v-if="consent === 'granted' && !loadFailure" class="basemap-wrap">
      <div ref="mapHost" class="basemap" role="img" aria-label="Ground track on a map"></div>
      <p class="attribution">{{ TILE_SOURCE.attributionText }} · {{ TILE_SOURCE.licence }}</p>
    </div>

    <template v-else>
      <GroundTrackMap v-if="track" :track="track" :playback="playback" :modes="modes" />
      <p class="rationale">
        No tiles are being requested. The track is drawn to scale from the logged coordinates with
        its geographic bounds labelled — everything a ground track is read for except the terrain
        underneath it.
      </p>
    </template>
  </div>
</template>

<style scoped>
.map-view {
  display: grid;
  gap: 0.9rem;
  max-width: 52rem;
}

.toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.dim {
  color: var(--fg-dim);
}

.consent {
  border: 1px solid var(--accent-dim);
  border-radius: 4px;
  padding: 0.9rem 1rem;
  background: var(--surface);
}

.consent h3 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
}

.consent ul {
  margin: 0 0 0.6rem;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--fg-dim);
  display: grid;
  gap: 0.25rem;
}

.reassure {
  color: var(--pass);
}

.licence {
  margin: 0 0 0.7rem;
  font-size: 0.72rem;
  color: var(--fg-dim);
}

.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.actions button {
  font: inherit;
  font-size: 0.78rem;
  padding: 0.35rem 0.7rem;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--fg);
  cursor: pointer;
}

.actions .primary {
  border-color: var(--accent);
  color: var(--accent);
}

.basemap-wrap {
  display: grid;
  gap: 0.3rem;
}

.basemap {
  height: 26rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface-sunken);
}

.attribution,
.rationale {
  margin: 0;
  font-size: 0.72rem;
  color: var(--fg-dim);
  line-height: 1.5;
}

.failure {
  margin: 0;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--fail);
  border-radius: 3px;
  color: var(--fail);
  font-size: 0.78rem;
}
</style>
