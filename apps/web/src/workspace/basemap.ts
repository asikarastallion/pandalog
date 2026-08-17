/**
 * Whether the map may talk to a tile server — doc 01 §5.2, ADR-0011 (revised).
 *
 * The default is off, and off means **no request leaves the page**: not a tile, not a stylesheet,
 * not the mapping library itself, which is loaded on demand so that declining costs nothing and
 * downloads nothing.
 *
 * Consent is asked for once and remembered per browser. It is asked for at all because a tile
 * request is not an ordinary asset fetch — the tile coordinates *are* the flight's location, so
 * every pan and zoom tells the tile server where the aircraft flew, and the timing tells it when
 * somebody looked. That is a disclosure only the user can weigh, and an application whose front
 * page promises the log never leaves the machine cannot make it on their behalf.
 *
 * Revocable, and revoking is immediate: the map returns to the projected-metres view and stops
 * requesting tiles.
 */

const STORAGE_KEY = 'pandalog.basemap.consent';

/**
 * The tile source offered.
 *
 * OpenStreetMap's own tile servers, because the data is openly licensed, the attribution
 * requirement is satisfiable in-page, and no API key exists to be embedded in the bundle — doc 04
 * §8 forbids shipping one, which rules out most commercial providers on its own.
 *
 * Their tile usage policy asks for a low-volume, human-driven load with clear attribution and no
 * bulk downloading. A flight-track view is exactly that: a handful of tiles for one bounding box,
 * fetched when a person opens the view.
 */
export const TILE_SOURCE = Object.freeze({
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  /** Rendered on the map, as the licence requires. */
  attributionHtml:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  attributionText: '© OpenStreetMap contributors',
  licence: 'Open Database Licence (ODbL)',
  host: 'tile.openstreetmap.org',
  maxZoom: 19,
});

/** What the user is told before they decide. Exported so the test asserts on the real wording. */
export const CONSENT_DISCLOSURE = Object.freeze({
  what: `Map tiles will be requested from ${TILE_SOURCE.host}, a third party PandaLog does not operate.`,
  why: 'Each tile request identifies the map area being viewed, so this discloses roughly where the aircraft flew, and when you looked at it.',
  notSent:
    'Your log file, its contents, the findings and the verification results are not sent. Only the map area is.',
  revocable: 'You can turn this off again at any time, and the map returns to the offline view.',
});

export type BasemapConsent = 'granted' | 'declined' | 'unasked';

const isConsent = (value: unknown): value is BasemapConsent =>
  value === 'granted' || value === 'declined' || value === 'unasked';

/**
 * Where the decision is remembered.
 *
 * `localStorage` rather than IndexedDB: it is one string, it must be readable synchronously before
 * the map renders, and a decision that arrived a frame late would mean a tile request fired before
 * the answer was known.
 */
export interface ConsentStore {
  read(): BasemapConsent;
  write(consent: BasemapConsent): void;
}

export function createConsentStore(storage: Storage | null = safeLocalStorage()): ConsentStore {
  return {
    read(): BasemapConsent {
      // Anything unreadable or unrecognised is `unasked`, never `granted`. A corrupted value must
      // not be able to turn the network on.
      try {
        const stored = storage?.getItem(STORAGE_KEY);
        return isConsent(stored) ? stored : 'unasked';
      } catch {
        return 'unasked';
      }
    },

    write(consent: BasemapConsent): void {
      try {
        storage?.setItem(STORAGE_KEY, consent);
      } catch {
        // A browser refusing storage is not a reason to fail; the choice simply lasts the session.
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True only for an explicit grant — the one state in which a tile may be requested. */
export const mayFetchTiles = (consent: BasemapConsent): boolean => consent === 'granted';
