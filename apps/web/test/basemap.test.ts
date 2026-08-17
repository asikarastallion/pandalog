/**
 * The map's two modes — doc 01 §5.2, ADR-0011 (revised).
 *
 * The property under test is a privacy one, so it is tested as a privacy one: **nothing but an
 * explicit grant may enable a network request.** Unset, unreadable, corrupted, or a storage engine
 * that throws all have to land on "do not fetch", because every one of those is a state a real
 * browser reaches and none of them is consent.
 */
import { describe, expect, it } from 'vitest';

import {
  CONSENT_DISCLOSURE,
  createConsentStore,
  mayFetchTiles,
  TILE_SOURCE,
  type BasemapConsent,
} from '../src/workspace/basemap.js';

/** A Storage double, so no real browser storage is touched. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  // Structurally a Storage already, so no cast is needed — which is the reassuring answer: the
  // double really does have the surface the code under test uses.
  return storage;
}

const throwingStorage = (): Storage =>
  ({
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
  }) as unknown as Storage;

describe('mayFetchTiles', () => {
  it('permits a request only for an explicit grant', () => {
    expect(mayFetchTiles('granted')).toBe(true);
    expect(mayFetchTiles('declined')).toBe(false);
    expect(mayFetchTiles('unasked')).toBe(false);
  });
});

describe('the remembered decision', () => {
  it('starts unasked, so the default sends nothing', () => {
    expect(createConsentStore(memoryStorage()).read()).toBe('unasked');
  });

  it('remembers a grant and a refusal', () => {
    for (const consent of ['granted', 'declined'] as BasemapConsent[]) {
      const storage = memoryStorage();
      createConsentStore(storage).write(consent);

      expect(createConsentStore(storage).read()).toBe(consent);
    }
  });

  it('treats a corrupted value as unasked rather than as consent', () => {
    // The direction of the failure is the point: a garbled setting must never be able to turn the
    // network on.
    const storage = memoryStorage({ 'pandalog.basemap.consent': 'yes-please' });

    expect(createConsentStore(storage).read()).toBe('unasked');
    expect(mayFetchTiles(createConsentStore(storage).read())).toBe(false);
  });

  it('treats storage that throws as unasked', () => {
    expect(createConsentStore(throwingStorage()).read()).toBe('unasked');
  });

  it('treats a browser with no storage at all as unasked', () => {
    expect(createConsentStore(null).read()).toBe('unasked');
  });

  it('survives a write it cannot persist, so the session still works', () => {
    const store = createConsentStore(throwingStorage());

    expect(() => {
      store.write('granted');
    }).not.toThrow();
  });
});

describe('what the user is told before deciding', () => {
  it('names the third party that will receive the requests', () => {
    expect(CONSENT_DISCLOSURE.what).toContain(TILE_SOURCE.host);
    expect(CONSENT_DISCLOSURE.what).toMatch(/third party/i);
  });

  it('says what the requests reveal, not merely that they happen', () => {
    // "Loads map tiles" would be true and useless. What matters is that tile coordinates disclose
    // where the aircraft flew.
    expect(CONSENT_DISCLOSURE.why).toMatch(/where .*flew|location/i);
  });

  it('says what is not sent, since that is the larger part', () => {
    expect(CONSENT_DISCLOSURE.notSent).toMatch(/log|findings/i);
    expect(CONSENT_DISCLOSURE.notSent).toMatch(/not sent/i);
  });

  it('says the choice can be reversed', () => {
    expect(CONSENT_DISCLOSURE.revocable).toMatch(/off|revoke|any time/i);
  });
});

describe('the tile source', () => {
  it('is https, so a request is not readable in transit', () => {
    expect(TILE_SOURCE.urlTemplate.startsWith('https://')).toBe(true);
  });

  it('carries attribution and a licence, as the data requires', () => {
    expect(TILE_SOURCE.attributionText).toMatch(/OpenStreetMap/);
    expect(TILE_SOURCE.attributionHtml).toContain('openstreetmap.org/copyright');
    expect(TILE_SOURCE.licence).toMatch(/ODbL|Open Database/);
  });

  it('needs no API key, so none can be embedded in the bundle (doc 04 §8)', () => {
    expect(TILE_SOURCE.urlTemplate).not.toMatch(/key|token|apikey|access_token/i);
  });
});
