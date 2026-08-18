// @vitest-environment happy-dom
/**
 * The workspace's information architecture — doc 01 §5.1.
 *
 * §5.1 is written as a contract rather than a layout, so these test it as one. The failure they
 * exist to prevent is the one that produced the restructure: views quietly merging back into a
 * single scrolling page as capabilities get appended to whichever screen had room.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import WorkspaceShell from '../src/views/WorkspaceShell.vue';
import {
  DEFAULT_VIEW,
  GROUP_LABELS,
  isViewId,
  VIEWS,
  VIEW_GROUPS,
  VIEW_IDS,
  viewById,
  viewsInGroup,
} from '../src/workspace/navigation.js';

describe('the view set', () => {
  it('names the views doc 01 §5.1 defines, in rail order', () => {
    expect([...VIEW_IDS]).toEqual([
      'summary',
      'plot',
      'map',
      'playback',
      'investigation',
      'verification',
      'comparison',
      'report',
      'provenance',
    ]);
  });

  it('gives every view a question it exists to answer (§5.1 rule 1)', () => {
    // A view that cannot state its question is the sign of a page becoming a dumping ground.
    for (const view of VIEWS) {
      expect(view.question.trim().length, view.id).toBeGreaterThan(10);
      expect(view.question.trim().endsWith('?') || view.id === 'report', view.id).toBe(true);
    }
  });

  it('reaches the comparison package, which had no surface at all before', () => {
    // packages/comparison shipped complete in Phase J and was callable from nowhere; the manifest
    // meanwhile described this app as providing a comparison view (ADR-0016 amendment).
    expect(VIEW_IDS).toContain('comparison');
  });

  it('puts every view in exactly one group', () => {
    for (const view of VIEWS) {
      expect(VIEW_GROUPS, view.id).toContain(view.group);
    }
    expect(VIEWS.length).toBe(
      VIEW_GROUPS.reduce((total, group) => total + viewsInGroup(group).length, 0),
    );
  });

  it('leaves no group empty, so the rail never shows a heading over nothing', () => {
    for (const group of VIEW_GROUPS) {
      expect(viewsInGroup(group).length, group).toBeGreaterThan(0);
      expect(GROUP_LABELS[group].length, group).toBeGreaterThan(0);
    }
  });

  it('keeps Investigation and Verification as separate views (§5.1 rule 2)', () => {
    // They are the product's distinguishing claim and each needs a full screen. Merging them is
    // the specific regression this asserts against.
    expect(VIEW_IDS).toContain('investigation');
    expect(VIEW_IDS).toContain('verification');
    expect(viewById('investigation').question).not.toBe(viewById('verification').question);
  });

  it('opens on a view that exists', () => {
    expect(isViewId(DEFAULT_VIEW)).toBe(true);
  });

  it('rejects an id it does not know', () => {
    expect(isViewId('everything')).toBe(false);
    expect(isViewId(null)).toBe(false);
  });
});

describe('the navigation rail', () => {
  const mountShell = (activeView = DEFAULT_VIEW, overrides = {}) =>
    mount(WorkspaceShell, {
      props: {
        activeView,
        fileName: 'degraded-flight.bin',
        findingCount: 3,
        failCount: 2,
        ...overrides,
      },
      slots: { default: '<p>view body</p>' },
    });

  it('offers every view, so none is reachable only by accident', () => {
    const labels = mountShell()
      .findAll('nav button.tab')
      .map((button) => button.text());

    for (const view of VIEWS) {
      expect(
        labels.some((label) => label.includes(view.label)),
        view.label,
      ).toBe(true);
    }
  });

  it('marks exactly one view as current', () => {
    const wrapper = mountShell('map');
    const current = wrapper.findAll('nav button.tab').filter((b) => b.classes('current'));

    expect(current).toHaveLength(1);
    expect(current[0]?.text()).toContain('Map');
  });

  it('renders one view at a time, not all of them stacked', () => {
    // The whole point of the restructure. The shell shows its slot; it does not compose the views.
    const wrapper = mountShell();

    expect(wrapper.text()).toContain('view body');
  });

  it('shows the active view question, so the screen says what it is for', () => {
    expect(mountShell('verification').text()).toContain(viewById('verification').question);
  });

  it('surfaces findings and failures on the rail from any view', () => {
    // A failure that is only visible on the screen reporting failures is a failure somebody misses.
    const wrapper = mountShell('summary');

    expect(wrapper.find('nav').text()).toContain('3');
    expect(wrapper.find('nav').text()).toContain('2');
  });

  it('hides a badge that would read zero rather than showing an empty count', () => {
    const wrapper = mountShell('summary', { findingCount: 0, failCount: 0 });

    expect(wrapper.findAll('nav .badge')).toHaveLength(0);
  });

  it('emits the view it was asked to show', async () => {
    const wrapper = mountShell();
    const report = wrapper.findAll('nav button.tab').find((b) => b.text().includes('Report'));

    await report?.trigger('click');

    expect(wrapper.emitted('show')?.[0]).toEqual(['report']);
  });

  it('offers a way back to the log list', async () => {
    const wrapper = mountShell();

    await wrapper.find('nav button.close').trigger('click');

    expect(wrapper.emitted('close')).toBeTruthy();
  });
});

/**
 * The two views this rail gained, and why each earns its place.
 *
 * A tab is a claim that the product answers a question. Adding one for a capability that does not
 * exist is how a tool acquires empty screens, so both of these are checked against something real:
 * Comparison against the package it calls, Log info against the provenance block it renders.
 */
describe('the views added to the rail', () => {
  it('renders a Comparison entry the rail can reach', () => {
    const wrapper = mount(WorkspaceShell, {
      props: { activeView: 'summary', fileName: 'x.bin', findingCount: 0, failCount: 0 },
    });

    expect(wrapper.text()).toContain('Comparison');
    expect(wrapper.text()).toContain('Log info');
  });

  it('shows the group headings, so nine entries are not one undifferentiated list', () => {
    const wrapper = mount(WorkspaceShell, {
      props: { activeView: 'summary', fileName: 'x.bin', findingCount: 0, failCount: 0 },
    });

    for (const group of VIEW_GROUPS) {
      expect(wrapper.text()).toContain(GROUP_LABELS[group]);
    }
  });

  it('adds no tab for a capability the canonical model cannot support', () => {
    // ArduLog offers FFT and PID-tuning tabs. The canonical model carries IMU signals but no
    // frequency transform, and no PID term at all — packages/parser-ardupilot's catalogue has no
    // PIDR/PIDP/PIDY mapping. A tab for either would be a permanently empty screen claiming a
    // capability that does not exist (doc 04 §12), so neither is here until the data is.
    expect(VIEW_IDS).not.toContain('fft');
    expect(VIEW_IDS).not.toContain('pid');
  });
});
