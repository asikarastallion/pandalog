/// <reference lib="webworker" />
/**
 * The Worker that runs the pipeline.
 *
 * Doc 05 Phase H requires the heavy work off the main thread: decoding a real flight log is tens of
 * megabytes of binary and millions of samples, and doing it on the UI thread freezes the tab for
 * however long it takes.
 *
 * There is no domain logic here. The Worker reads a request, calls `runPipeline` — the same
 * composition `@pandalog/cli` runs (ADR-0010) — and posts the result back as transferable columns.
 * That is the whole file, and it is deliberately the whole file: anything that made a decision
 * about the flight would be a decision the CLI does not make.
 */
import { runPipeline } from '@pandalog/pipeline';

import { encodeResult, transferablesOf } from './transfer.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The error code an ingestion/analysis failure carries, when it carries one. */
function codeOf(error: unknown): string | null {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null;
}

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  void (async () => {
    try {
      const result = await runPipeline({
        fileName: request.fileName,
        bytes: new Uint8Array(request.bytes),
        now: () => new Date(),
      });

      const payload = encodeResult(result);
      const response: WorkerResponse = {
        kind: 'ok',
        requestId: request.requestId,
        result: payload,
      };
      scope.postMessage(response, transferablesOf(payload));
    } catch (error) {
      const response: WorkerResponse = {
        kind: 'error',
        requestId: request.requestId,
        message: describe(error),
        code: codeOf(error),
      };
      scope.postMessage(response);
    }
  })();
});
