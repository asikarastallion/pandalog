/**
 * The workspace's views — doc 01 §5.1.
 *
 * A list rather than a router: the app has one level of navigation inside one log, no URLs to own
 * and no history to manage, so a router would be a dependency and a second source of truth for
 * something a `ref<ViewId>` already holds.
 *
 * Each view carries the *question it answers*. That is not decoration — §5.1 rule 1 says a new
 * capability becomes a view or extends the one whose question it belongs to, and a view that cannot
 * state its question is the sign of a page becoming a dumping ground again.
 */

export const VIEW_IDS = [
  'summary',
  'plot',
  'map',
  'playback',
  'investigation',
  'verification',
  'report',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export interface ViewDefinition {
  readonly id: ViewId;
  readonly label: string;
  /** One glyph, drawn as text. No icon font, no sprite sheet, no extra request. */
  readonly glyph: string;
  /** The single question this view exists to answer (doc 01 §5.1). */
  readonly question: string;
}

export const VIEWS: readonly ViewDefinition[] = Object.freeze([
  Object.freeze({
    id: 'summary' as const,
    label: 'Summary',
    glyph: '▤',
    question: 'What is this flight, and what did the analysis conclude overall?',
  }),
  Object.freeze({
    id: 'plot' as const,
    label: 'Plot',
    glyph: '∿',
    question: 'What did these signals do, against each other, over time?',
  }),
  Object.freeze({
    id: 'map' as const,
    label: 'Map',
    glyph: '◎',
    question: 'Where did it fly?',
  }),
  Object.freeze({
    id: 'playback' as const,
    label: '3D Playback',
    glyph: '◈',
    question: 'What was it doing at this instant, along the path it actually flew?',
  }),
  Object.freeze({
    id: 'investigation' as const,
    label: 'Investigation',
    glyph: '⌕',
    question: 'What was found, what proves it, and what were the samples behind it?',
  }),
  Object.freeze({
    id: 'verification' as const,
    label: 'Verification',
    glyph: '✓',
    question: 'Did it meet each requirement, and on what evidence?',
  }),
  Object.freeze({
    id: 'report' as const,
    label: 'Report',
    glyph: '📄',
    question: 'The reproducible, provenance-stamped document.',
  }),
]);

const BY_ID: ReadonlyMap<ViewId, ViewDefinition> = new Map(VIEWS.map((view) => [view.id, view]));

export const viewById = (id: ViewId): ViewDefinition => {
  const view = BY_ID.get(id);
  if (view === undefined) {
    throw new Error(`Unknown view ${id}`);
  }
  return view;
};

export const isViewId = (value: unknown): value is ViewId =>
  typeof value === 'string' && (VIEW_IDS as readonly string[]).includes(value);

/** The view a freshly opened log lands on. */
export const DEFAULT_VIEW: ViewId = 'summary';
