/**
 * The Worker message contract.
 *
 * Kept in its own module, free of both `runPipeline` and any DOM API, so the main thread and the
 * Worker agree on one set of types rather than two that happen to match. `requestId` is carried on
 * both halves so a response is matched to its request instead of to whichever one was in flight —
 * a user who drops a second log while the first is still parsing must not see the first log's
 * findings labelled with the second log's name.
 */
import type { TransferableResult } from './transfer.js';

export interface AnalyseRequest {
  readonly kind: 'analyse';
  readonly requestId: number;
  readonly fileName: string;
  /** The log's bytes. Transferred rather than copied. */
  readonly bytes: ArrayBuffer;
}

export type WorkerRequest = AnalyseRequest;

export type WorkerResponse =
  | { readonly kind: 'ok'; readonly requestId: number; readonly result: TransferableResult }
  | {
      readonly kind: 'error';
      readonly requestId: number;
      readonly message: string;
      /** The originating package's error code, when it had one (e.g. `NO_ADAPTER`). */
      readonly code: string | null;
    };
