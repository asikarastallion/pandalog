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
import { describeFailure } from './failure.js';
import { playbackStateAt, type PlaybackState } from './playback.js';
import { buildGroundTrack, type GroundTrack } from './track.js';

/** How much flight either side of a finding's evidence to show for context. */
const CONTEXT_PADDING_SECONDS = 1;

export type LoadState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly fileName: string }
  | { readonly status: 'ready'; readonly fileName: string }
  | {
      readonly status: 'failed';
      readonly fileName: string;
      /** What the domain package said, verbatim. */
      readonly message: string;
      /** What the person who dropped the file can do about it (see `failure.ts`). */
      readonly guidance: string;
    };

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

  /** Playback clock. UI state (doc 01 §5) — the flight data it reads is not. */
  readonly playbackTime: Readonly<Ref<number>>;
  readonly isPlaying: Readonly<Ref<boolean>>;
  /** The vehicle's state at `playbackTime`, derived rather than stored. */
  readonly playback: ComputedRef<PlaybackState | null>;
  readonly groundTrack: ComputedRef<GroundTrack | null>;

  beginLoad(fileName: string): void;
  setResult(fileName: string, result: PipelineResult): void;
  /** Takes the thrown value, not a string: the error's `code` is what selects the guidance. */
  failLoad(fileName: string, thrown: unknown): void;
  selectFinding(findingId: string | null): void;
  toggleExtraSignal(signalId: string): void;
  seek(tSeconds: number): void;
  setPlaying(playing: boolean): void;
  /** Advance the clock by a wall-clock delta, stopping at the end of the flight. */
  advance(deltaSeconds: number): void;
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

  const playbackTime = shallowRef(0);
  const isPlaying = shallowRef(false);

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

  const playback = computed<PlaybackState | null>(() => {
    const current = result.value;
    return current === null ? null : playbackStateAt(current, playbackTime.value);
  });

  const groundTrack = computed<GroundTrack | null>(() => {
    const current = result.value;
    return current === null ? null : buildGroundTrack(current.dataset);
  });

  const clampToFlight = (tSeconds: number): number => {
    const span = flightWindow.value;
    if (span === null) {
      return tSeconds;
    }
    return Math.min(Math.max(tSeconds, span.startSeconds), span.endSeconds);
  };

  return {
    load: readonly(load),
    result: readonly(result),
    selectedFindingId: readonly(selectedFindingId),
    extraSignalIds: readonly(extraSignalIds),
    findings,
    investigation,
    availableSignalIds,
    flightWindow,
    playbackTime: readonly(playbackTime),
    isPlaying: readonly(isPlaying),
    playback,
    groundTrack,

    beginLoad(fileName: string): void {
      load.value = { status: 'loading', fileName };
      result.value = null;
      selectedFindingId.value = null;
      extraSignalIds.value = [];
      playbackTime.value = 0;
      isPlaying.value = false;
    },

    setResult(fileName: string, next: PipelineResult): void {
      result.value = next;
      load.value = { status: 'ready', fileName };
      // Open the first finding by flight time, so the workspace lands on something to investigate
      // rather than an empty pane. Null when the flight produced none, which is itself the answer.
      selectedFindingId.value = findingsByTime(next.findings)[0]?.finding.id ?? null;
      isPlaying.value = false;
      // Start the clock at the beginning of the flight, not at zero: a log whose time base does
      // not start at zero would otherwise open on an instant before any data exists.
      playbackTime.value = clampToFlight(Number.NEGATIVE_INFINITY);
    },

    failLoad(fileName: string, thrown: unknown): void {
      const { message, guidance } = describeFailure(thrown);
      load.value = { status: 'failed', fileName, message, guidance };
      result.value = null;
      selectedFindingId.value = null;
    },

    selectFinding(findingId: string | null): void {
      selectedFindingId.value = findingId;
    },

    seek(tSeconds: number): void {
      playbackTime.value = clampToFlight(tSeconds);
    },

    setPlaying(playing: boolean): void {
      isPlaying.value = playing;
    },

    advance(deltaSeconds: number): void {
      const span = flightWindow.value;
      const next = playbackTime.value + deltaSeconds;
      if (span !== null && next >= span.endSeconds) {
        playbackTime.value = span.endSeconds;
        isPlaying.value = false;
        return;
      }
      playbackTime.value = clampToFlight(next);
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
      playbackTime.value = 0;
      isPlaying.value = false;
    },
  };
}

/** Injection key for the single workspace instance. */
export const WORKSPACE_KEY = Symbol('pandalog.workspace');
