/**
 * Turning a failure into something a person can act on.
 *
 * The deterministic packages already fail correctly: a malformed log raises a structured
 * `IngestionError` with a code, and no partial dataset is ever returned. Their messages are accurate
 * and written for whoever maintains the parser — *"No registered parser adapter claims
 * "photo.png". Registered formats: ardupilot-dataflash."* is exactly right and tells someone who
 * dropped a holiday snap nothing about what to do next.
 *
 * So this module adds a second sentence rather than replacing the first. The split is deliberate
 * and is the boundary doc 04 §1 rule 1 draws:
 *
 *   the **code** is the domain's contract — this layer keys on it and never second-guesses it;
 *   the **wording** is presentation — which is the UI's job, and is all this module does.
 *
 * The domain message is always shown too. A user pasting an error into an issue should be pasting
 * what the packages actually said, not a UI paraphrase of it.
 */

/**
 * Largest log this app will read into memory.
 *
 * A browser tab has to hold the file, the decoded dataset and the derived signals at once, and
 * `File.arrayBuffer()` on a multi-gigabyte file will take the tab down before any code of ours
 * runs — which is the one failure mode that produces no message at all. 512 MB is far above any
 * real ArduPilot log (a long sortie is tens of megabytes) and far below the size at which a tab
 * dies, so the guard only ever catches a file that was never a flight log.
 *
 * Doc 04 §8 requires imported logs to be checked for size before their content is trusted. The CLI
 * has no such limit and should not: it streams from disk in a process that can be given more
 * memory, and a headless run failing is visible in a way a dead tab is not.
 */
export const MAX_LOG_BYTES = 512 * 1024 * 1024;

export interface DescribedFailure {
  /** What the domain said, verbatim. */
  readonly message: string;
  /** What the person who dropped the file can do about it. */
  readonly guidance: string;
}

/** Human-readable size, for a message somebody reads rather than parses. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'an unknown size';
  }
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.round(megabytes)} MB`;
}

/**
 * A file refused on size, before a byte of it was read.
 *
 * Carries a code like the domain errors do, so it flows through `describeFailure` on the same path
 * as everything else rather than needing a special case in the view.
 */
export class LogTooLargeError extends Error {
  readonly code = 'FILE_TOO_LARGE';

  constructor(message: string) {
    super(message);
    this.name = 'LogTooLargeError';
  }
}

/** Why a file was refused before it was read at all. */
export const tooLargeMessage = (fileName: string, bytes: number): string =>
  `${fileName} is ${formatBytes(bytes)}, and this app reads logs up to ${formatBytes(MAX_LOG_BYTES)}. ` +
  'The whole file has to fit in this browser tab alongside the decoded flight data, and a file ' +
  'this large would end the tab before any error could be shown. Nothing was read.';

/**
 * Guidance per error code.
 *
 * Keyed on the code rather than matched against message text, so a reworded domain message does not
 * silently drop a user back to the generic case.
 */
const GUIDANCE: Readonly<Record<string, string>> = Object.freeze({
  FILE_TOO_LARGE:
    'Nothing was read, so nothing was lost. If this really is a flight log, the CLI has no such ' +
    'limit — it runs the identical pipeline outside a browser tab.',
  NO_ADAPTER:
    'This does not look like an ArduPilot DataFlash log. PandaLog reads binary .BIN files as ' +
    'written by the flight controller — not .log text exports, and not other file types. Renaming ' +
    'a file to .BIN does not change what is inside it.',
  EMPTY_SOURCE:
    'The file contains no bytes at all. It was probably created but never written to — check the ' +
    'copy or download that produced it, and try the original from the flight controller.',
  ADAPTER_FAILED:
    'The file starts like a DataFlash log but could not be decoded — most often because it is ' +
    'truncated or damaged, for instance if the vehicle lost power mid-write or the download was ' +
    'interrupted. Nothing was analysed: a malformed log is never partially salvaged, because half ' +
    'a flight silently presented as a whole one is worse than no answer.',
  INVALID_DATASET:
    'The log decoded, but the result broke a rule the canonical flight-data model guarantees. That ' +
    'is a defect in PandaLog rather than in your file — the message above is what to report.',
  TRANSFER_FAILED:
    'The log was analysed, but the result could not be handed back from the background worker to ' +
    'the page. Reloading and trying again is worth one attempt; if it repeats, that is a defect in ' +
    'PandaLog and the message above is what to report.',
  WORKER_FAILED:
    'The background worker that analyses logs stopped before it could answer. Reload the page and ' +
    'try again. If it happens every time, that is a defect in PandaLog.',
});

const FALLBACK =
  'PandaLog could not analyse this file, and the message above is all it was able to say. If the ' +
  'file opens elsewhere as an ArduPilot log, that is a defect worth reporting with this message.';

const describe = (thrown: unknown): string => {
  if (thrown instanceof Error && thrown.message.trim().length > 0) {
    return thrown.message;
  }
  const rendered = typeof thrown === 'string' ? thrown : String(thrown);
  // An empty or object-shaped throw would otherwise render as "" or "[object Object]", which reads
  // to a user as though nothing went wrong at all.
  return rendered.trim().length === 0 || rendered === '[object Object]'
    ? 'The analysis failed without reporting a reason.'
    : rendered;
};

const codeOf = (thrown: unknown): string | null =>
  thrown !== null && typeof thrown === 'object' && 'code' in thrown ? String(thrown.code) : null;

/** Describe a failure for the person who caused it, without discarding what the domain said. */
export function describeFailure(thrown: unknown): DescribedFailure {
  const code = codeOf(thrown);
  return {
    message: describe(thrown),
    guidance: (code === null ? undefined : GUIDANCE[code]) ?? FALLBACK,
  };
}
