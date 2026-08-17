/**
 * Recently analysed logs, kept in IndexedDB — doc 01 §2, §5.1.
 *
 * **What is stored is the log's own bytes, plus a summary for the list.** Not the decoded dataset,
 * not the findings, not the verification results. Re-opening a stored log re-runs the pipeline over
 * the same bytes, which doc 03 §6 guarantees produces byte-identical findings and outcomes — so a
 * cache of the results would be a second copy of something already reproducible, and one that could
 * fall out of date the moment a rule version changed. Storing the source and re-deriving keeps the
 * displayed analysis always current with the code that is running.
 *
 * The summary duplicates a handful of values purely so the landing list can be drawn without
 * decoding every stored log. It is display data with a `pipelineVersion` stamp; anything a user acts
 * on is re-derived, never read from here.
 *
 * This is local storage in a browser profile, not a sync feature. There is no server (§2), so a log
 * stored here is on this machine in this browser and nowhere else — including not on any other
 * browser on the same machine.
 */
import type { VerificationOutcome } from '@pandalog/verification';

const DATABASE_NAME = 'pandalog';
const DATABASE_VERSION = 1;
const STORE = 'logs';

/**
 * How many logs are kept.
 *
 * A cap rather than unbounded growth: these are whole flight logs, and a browser evicting the
 * origin's storage under pressure would take the lot without warning. Twenty is enough to cover
 * the sorties anyone compares in a sitting.
 */
export const MAX_STORED_LOGS = 20;

export interface StoredLogSummary {
  /** The source SHA-256 — the identity of the bytes, so re-opening the same log replaces it. */
  readonly sha256: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly analysedAtUtc: string;
  readonly durationSeconds: number | null;
  readonly findingCount: number;
  readonly outcomes: Readonly<Record<VerificationOutcome, number>>;
}

export interface StoredLog extends StoredLogSummary {
  readonly bytes: ArrayBuffer;
}

export interface LogStore {
  list(): Promise<readonly StoredLogSummary[]>;
  get(sha256: string): Promise<StoredLog | null>;
  put(entry: StoredLog): Promise<void>;
  remove(sha256: string): Promise<void>;
  clear(): Promise<void>;
}

/** Promisify one IndexedDB request. */
const request = <T>(source: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    source.onsuccess = () => {
      resolve(source.result);
    };
    source.onerror = () => {
      reject(source.error ?? new Error('IndexedDB request failed'));
    };
  });

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'sha256' });
        // Sorted on read rather than in the store, but the index makes "most recent first" cheap
        // once there are enough entries to matter.
        store.createIndex('analysedAtUtc', 'analysedAtUtc');
      }
    };

    open.onsuccess = () => {
      resolve(open.result);
    };
    open.onerror = () => {
      reject(open.error ?? new Error('Could not open the PandaLog database'));
    };
  });
}

const summaryOf = (entry: StoredLog): StoredLogSummary => ({
  sha256: entry.sha256,
  fileName: entry.fileName,
  sizeBytes: entry.sizeBytes,
  analysedAtUtc: entry.analysedAtUtc,
  durationSeconds: entry.durationSeconds,
  findingCount: entry.findingCount,
  outcomes: entry.outcomes,
});

/** Most recent first, which is the order the landing list reads in. */
const byMostRecent = (a: StoredLogSummary, b: StoredLogSummary): number =>
  b.analysedAtUtc.localeCompare(a.analysedAtUtc);

export function createLogStore(): LogStore {
  const withStore = async <T>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const database = await openDatabase();
    try {
      return await use(database.transaction(STORE, mode).objectStore(STORE));
    } finally {
      database.close();
    }
  };

  return {
    async list(): Promise<readonly StoredLogSummary[]> {
      const entries = await withStore('readonly', (store) =>
        request(store.getAll() as IDBRequest<StoredLog[]>),
      );
      return entries.map(summaryOf).sort(byMostRecent);
    },

    async get(sha256: string): Promise<StoredLog | null> {
      const entry = await withStore('readonly', (store) =>
        request(store.get(sha256) as IDBRequest<StoredLog | undefined>),
      );
      return entry ?? null;
    },

    async put(entry: StoredLog): Promise<void> {
      await withStore('readwrite', async (store) => {
        await request(store.put(entry));

        // Trim oldest-first, in the same transaction, so the cap holds even if the tab is closed
        // immediately afterwards.
        const all = await request(store.getAll() as IDBRequest<StoredLog[]>);
        const doomed = all.map(summaryOf).sort(byMostRecent).slice(MAX_STORED_LOGS);
        for (const stale of doomed) {
          await request(store.delete(stale.sha256));
        }
      });
    },

    async remove(sha256: string): Promise<void> {
      await withStore('readwrite', (store) => request(store.delete(sha256)));
    },

    async clear(): Promise<void> {
      await withStore('readwrite', (store) => request(store.clear()));
    },
  };
}

/**
 * A store that keeps nothing, for a browser where IndexedDB is unavailable or blocked.
 *
 * Private-browsing modes and hardened profiles refuse it. The workspace works without history, so
 * losing persistence must degrade to "the list is empty" rather than to a page that will not open —
 * the analysis, which is the product, needs no storage at all.
 */
export const createNullLogStore = (): LogStore => ({
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  put: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  clear: () => Promise.resolve(),
});

/** The real store when the browser allows one, a store that forgets when it does not. */
export function createAvailableLogStore(): LogStore {
  try {
    return typeof indexedDB === 'undefined' ? createNullLogStore() : createLogStore();
  } catch {
    return createNullLogStore();
  }
}
