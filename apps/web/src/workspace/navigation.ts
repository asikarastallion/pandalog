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
  'comparison',
  'report',
  'provenance',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

/**
 * The three things an engineer does with a log, in the order they do them.
 *
 * Grouping is not decoration at nine entries: a flat rail of nine makes every view look equally
 * likely, and the rail's job is to say what kind of question each one answers. The groups are
 * PandaLog's own — deliberately not a copy of another tool's tab bar, which would import that
 * tool's idea of what a log is for.
 */
export const VIEW_GROUPS = ['visualize', 'analyze', 'data'] as const;

export type ViewGroup = (typeof VIEW_GROUPS)[number];

export const GROUP_LABELS: Readonly<Record<ViewGroup, string>> = Object.freeze({
  visualize: 'Visualize',
  analyze: 'Analyze',
  data: 'Data',
});

export interface ViewDefinition {
  readonly id: ViewId;
  readonly label: string;
  /** One glyph, drawn as text. No icon font, no sprite sheet, no extra request. */
  readonly glyph: string;
  /** The single question this view exists to answer (doc 01 §5.1). */
  readonly question: string;
  readonly group: ViewGroup;
}

export const VIEWS: readonly ViewDefinition[] = Object.freeze([
  Object.freeze({
    id: 'summary' as const,
    label: 'Summary',
    glyph: '▤',
    question: 'What is this flight, and what did the analysis conclude overall?',
    group: 'visualize' as const,
  }),
  Object.freeze({
    id: 'plot' as const,
    label: 'Plot',
    glyph: '∿',
    question: 'What did these signals do, against each other, over time?',
    group: 'visualize' as const,
  }),
  Object.freeze({
    id: 'map' as const,
    label: 'Map',
    glyph: '◎',
    question: 'Where did it fly?',
    group: 'visualize' as const,
  }),
  Object.freeze({
    id: 'playback' as const,
    label: '3D Playback',
    glyph: '◈',
    question: 'What was it doing at this instant, along the path it actually flew?',
    group: 'visualize' as const,
  }),
  Object.freeze({
    id: 'investigation' as const,
    label: 'Investigation',
    glyph: '⌕',
    question: 'What was found, what proves it, and what were the samples behind it?',
    group: 'analyze' as const,
  }),
  Object.freeze({
    id: 'verification' as const,
    label: 'Verification',
    glyph: '✓',
    question: 'Did it meet each requirement, and on what evidence?',
    group: 'analyze' as const,
  }),
  Object.freeze({
    id: 'comparison' as const,
    label: 'Comparison',
    glyph: '⇄',
    question: 'How did this flight differ from another one, and where can it not be compared?',
    group: 'analyze' as const,
  }),
  Object.freeze({
    id: 'report' as const,
    label: 'Report',
    glyph: '📄',
    question: 'The reproducible, provenance-stamped document.',
    group: 'data' as const,
  }),
  Object.freeze({
    id: 'provenance' as const,
    label: 'Log info',
    glyph: '⌗',
    question: 'What exactly was analysed, by what, at which versions?',
    group: 'data' as const,
  }),
]);

/** The views of one group, in rail order. */
export const viewsInGroup = (group: ViewGroup): readonly ViewDefinition[] =>
  VIEWS.filter((view) => view.group === group);

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
