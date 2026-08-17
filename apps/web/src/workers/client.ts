/**
 * Main-thread side of the Worker.
 *
 * Turns the message protocol into a promise, and drops responses whose `requestId` is stale. That
 * last part is not defensive padding: dropping a second log onto the workspace while the first is
 * still parsing is an ordinary thing to do, and without the check the slower of the two would
 * overwrite the newer result with older findings under the newer file's name.
 */
import { decodeResult } from './transfer.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import type { PipelineResult } from '@pandalog/pipeline';

export class PipelineFailure extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'PipelineFailure';
    this.code = code;
  }
}

export interface PipelineClient {
  analyse(fileName: string, bytes: ArrayBuffer): Promise<PipelineResult>;
  dispose(): void;
}

/** Anything that behaves like a Worker, so a test can substitute one. */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface Pending {
  readonly resolve: (result: PipelineResult) => void;
  readonly reject: (error: Error) => void;
}

export function createPipelineClient(worker: WorkerLike): PipelineClient {
  const pending = new Map<number, Pending>();
  let nextRequestId = 1;

  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const waiting = pending.get(response.requestId);
    if (waiting === undefined) {
      // A response for a request nobody is waiting on — a superseded load. Dropping it is the
      // correct handling, not an oversight.
      return;
    }
    pending.delete(response.requestId);

    if (response.kind === 'error') {
      waiting.reject(new PipelineFailure(response.message, response.code));
      return;
    }

    try {
      waiting.resolve(decodeResult(response.result));
    } catch (error) {
      waiting.reject(
        new PipelineFailure(
          `The log was analysed but its result could not be read back: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'TRANSFER_FAILED',
        ),
      );
    }
  });

  worker.addEventListener('error', (event: ErrorEvent) => {
    // The Worker itself failed to run. Every waiter must hear about it, or the UI sits on a
    // spinner for ever.
    const failure = new PipelineFailure(
      event.message.length > 0 ? event.message : 'The analysis worker stopped unexpectedly.',
      'WORKER_FAILED',
    );
    for (const [, waiting] of pending) {
      waiting.reject(failure);
    }
    pending.clear();
  });

  return {
    analyse(fileName: string, bytes: ArrayBuffer): Promise<PipelineResult> {
      const requestId = nextRequestId;
      nextRequestId += 1;

      return new Promise<PipelineResult>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        worker.postMessage({ kind: 'analyse', requestId, fileName, bytes }, [bytes]);
      });
    },

    dispose(): void {
      worker.terminate();
      pending.clear();
    },
  };
}

/** The real Worker, built the way Vite expects so the bundle splits correctly. */
export function createDefaultPipelineClient(): PipelineClient {
  return createPipelineClient(
    new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' }),
  );
}
