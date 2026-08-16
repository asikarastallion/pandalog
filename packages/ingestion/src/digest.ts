/**
 * Source hashing for provenance.
 *
 * Uses Web Crypto (`globalThis.crypto.subtle`), which is present both in browsers and in Node 20+,
 * so this package stays `platformNeutral: true` — the same code runs in a Web Worker and under the
 * CLI (doc 01 §2). Nothing is imported from `node:crypto`.
 *
 * Deployment note for Phase H: `crypto.subtle` is only exposed in secure contexts. https and
 * localhost qualify; opening the built app directly from `file://` may not, depending on the
 * browser. That surfaces here as a loud `DIGEST_UNAVAILABLE` error rather than an unhashed
 * dataset, because provenance without a real hash would make a report unreproducible while looking
 * complete.
 */
import { IngestionError } from './errors.js';

/**
 * The slice of Web Crypto this module needs, declared structurally.
 *
 * Referencing the ambient `SubtleCrypto` type would pull in the DOM lib, and `node:crypto` would
 * pull in Node — either one would break `platformNeutral: true`. Describing only the one method
 * used keeps the package free of both while still typing the call.
 */
interface SubtleCryptoLike {
  digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>;
}

function getSubtleCrypto(): SubtleCryptoLike | undefined {
  const runtime = globalThis as { crypto?: { subtle?: SubtleCryptoLike } };
  return runtime.crypto?.subtle;
}

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += HEX[byte >> 4];
    hex += HEX[byte & 0x0f];
  }
  return hex;
}

/** SHA-256 of the source bytes, lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = getSubtleCrypto();
  if (subtle === undefined) {
    throw new IngestionError(
      'DIGEST_UNAVAILABLE',
      'Web Crypto (crypto.subtle) is unavailable, so the source file cannot be hashed. ' +
        'Provenance requires a real SHA-256; ingestion fails rather than recording a placeholder.',
    );
  }

  // Copy into a fresh buffer: the caller's view may be over a larger ArrayBuffer, and digesting
  // the whole buffer would hash bytes that are not part of this file.
  const digest = await subtle.digest('SHA-256', bytes.slice().buffer);
  return toHex(new Uint8Array(digest));
}
