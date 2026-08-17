/**
 * The workspace state model — 01_SYSTEM_ARCHITECTURE.md §4 and §5.
 *
 * Doc 05 Phase H asks for one state model shared across the views, with no per-page duplicated
 * domain state, and doc 01 §5 draws the line precisely:
 *
 * > View-specific state (selection, zoom, active tab) is UI state; flight data, findings, and
 * > verification results are not.
 *
 * So this module holds exactly two things: the `PipelineResult` as the packages produced it, and
 * the operator's selection. It defines no parallel shape for a finding or a signal — components
 * render the canonical types directly (doc 01 §5), because a "UI model" mirroring them is the
 * parallel representation doc 04 forbids, and the place where the number on screen starts drifting
 * from the number in the evidence.
 *
 * Everything derived — the open investigation, the ordered findings — is a `computed`, not a copy.
 * There is no state to keep in sync because there is no second copy to keep in sync with.
 */
import { computed, readonly, shallowRef, type ComputedRef, type DeepReadonly, type Ref } from 'vue';

import type { PipelineResult } from '@pandalog/pipeline';
import { timeSpanOf, type TimeWindow } from '@pandalog/query';

import { findingsByTime, openInvestigation, type Investigation } from './investigation.js';

/** How much flight either side of a finding's evidence to show for context. */
const CONTEXT_PADDING_SECONDS = 1;

export type LoadState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly fileName: string }
  | { readonly status: 'ready'; readonly fileName: string }
  | { readonly status: 'failed'; readonly fileName: string; readonly message: string };

export interface Workspace {
  readonly load: Readonly<Ref<LoadState>>;
  readonly result: Readonly<Ref<PipelineResult | null>>;
  readonly selectedFindingId: Readonly<Ref<string | null>>;
  readonly extraSignalIds: DeepReadonly<Ref<readonly string[]>>;

  readonly findings: ComputedRef<ReturnType<typeof findingsByTime>>;
  readonly investigation: ComputedRef<Investigation | null>;
  readonly availableSignalIds: ComputedRef<readonly string[]>;
  /** The whole flight's extent, for placing an investigation against the full timeline. */
  readonly flightWindow: ComputedRef<TimeWindow | null>;

  beginLoad(fileName: string): void;
  setResult(fileName: string, result: PipelineResult): void;
  failLoad(fileName: string, message: string): void;
  selectFinding(findingId: string | null): void;
  toggleExtraSignal(signalId: string): void;
  reset(): void;
}

export function createWorkspace(): Workspace {
  const load = shallowRef<LoadState>({ status: 'empty' });
  // shallowRef, not ref: a PipelineResult holds frozen domain objects and typed-array-backed
  // signals. Deep reactivity would walk millions of samples to install proxies that nothing needs,
  // and would wrap the Signal proxy in a second one.
  const result = shallowRef<PipelineResult | null>(null);
  const selectedFindingId = shallowRef<string | null>(null);
  const extraSignalIds = shallowRef<readonly string[]>([]);

  const findings = computed(() => findingsByTime(result.value?.findings ?? []));

  const investigation = computed(() => {
    const current = result.value;
    const findingId = selectedFindingId.value;
    if (current === null || findingId === null) {
      return null;
    }
    return openInvestigation(current, findingId, {
      extraSignalIds: extraSignalIds.value,
      paddingSeconds: CONTEXT_PADDING_SECONDS,
    });
  });

  const availableSignalIds = computed(() =>
    [...(result.value?.dataset.signals.keys() ?? [])].sort((a, b) => a.localeCompare(b)),
  );

  const flightWindow = computed<TimeWindow | null>(() => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;

    for (const signal of result.value?.dataset.signals.values() ?? []) {
      const span = timeSpanOf(signal);
      if (span === null) {
        continue;
      }
      start = Math.min(start, span.startSeconds);
      end = Math.max(end, span.endSeconds);
    }

    return Number.isFinite(start) && Number.isFinite(end)
      ? { startSeconds: start, endSeconds: end }
      : null;
  });

  return {
    load: readonly(load),
    result: readonly(result),
    selectedFindingId: readonly(selectedFindingId),
    extraSignalIds: readonly(extraSignalIds),
    findings,
    investigation,
    availableSignalIds,
    flightWindow,

    beginLoad(fileName: string): void {
      load.value = { status: 'loading', fileName };
      result.value = null;
      selectedFindingId.value = null;
      extraSignalIds.value = [];
    },

    setResult(fileName: string, next: PipelineResult): void {
      result.value = next;
      load.value = { status: 'ready', fileName };
      // Open the first finding by flight time, so the workspace lands on something to investigate
      // rather than an empty pane. Null when the flight produced none, which is itself the answer.
      selectedFindingId.value = findingsByTime(next.findings)[0]?.finding.id ?? null;
    },

    failLoad(fileName: string, message: string): void {
      load.value = { status: 'failed', fileName, message };
      result.value = null;
      selectedFindingId.value = null;
    },

    selectFinding(findingId: string | null): void {
      selectedFindingId.value = findingId;
    },

    toggleExtraSignal(signalId: string): void {
      const current = extraSignalIds.value;
      extraSignalIds.value = current.includes(signalId)
        ? current.filter((id) => id !== signalId)
        : [...current, signalId];
    },

    reset(): void {
      load.value = { status: 'empty' };
      result.value = null;
      selectedFindingId.value = null;
      extraSignalIds.value = [];
    },
  };
}

/** Injection key for the single workspace instance. */
export const WORKSPACE_KEY = Symbol('pandalog.workspace');
