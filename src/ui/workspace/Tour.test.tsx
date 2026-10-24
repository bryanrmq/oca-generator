// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../../core/model';
import { useStore } from '../../state/store';
import { OUTPUT_OPEN_KEY } from '../lib/paneLayout';
import { TOUR_SEEN_KEY, loadTourSeen } from '../lib/tour';
import { Workspace } from './Workspace';

const tour = () => screen.getByRole('dialog', { name: 'Workspace tour' });
const heading = () => within(tour()).getByRole('heading').textContent;
const shownPane = () => within(screen.getByRole('tablist', { name: 'Panes' })).getByRole('tab', { selected: true }).textContent;
const features = () => within(tour()).getAllByRole('listitem').map((item) => item.textContent);
const keys = () => within(tour()).queryAllByRole('listitem').flatMap((item) => [...item.querySelectorAll('kbd')].map((key) => key.textContent));
async function next(user: ReturnType<typeof userEvent.setup>, times = 1) {
  for (let step = 0; step < times; step++) await user.click(within(tour()).getByRole('button', { name: 'Next' }));
}

/** Makes the window narrower than 1000 px, where the workspace shows one pane at a time. */
function narrowWindow() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

/** Gives the area marked `data-tour={target}` a size on screen, which jsdom leaves at zero. */
function layOut(target: string) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const size = this.dataset.tour === target ? { width: 800, height: 200 } : { width: 0, height: 0 };
    return { top: 500, left: 0, right: size.width, bottom: 500 + size.height, x: 0, y: 500, ...size, toJSON: () => ({}) };
  });
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().close();
  useStore.getState().load(emptyProject(['de-CH', 'en-GB']));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Tour', () => {
  it('opens by itself and walks through every area of the workspace', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    expect(heading()).toBe('Welcome to the workspace');
    expect(within(tour()).getByText('1 of 7')).toBeInTheDocument();
    expect(within(tour()).queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(within(tour()).getByRole('button', { name: 'Next' })).toHaveFocus();

    const visited = [];
    for (let step = 0; step < 6; step++) {
      await user.click(within(tour()).getByRole('button', { name: 'Next' }));
      visited.push(heading());
    }
    expect(visited).toEqual(['Structure', 'Edit', 'Output', 'Issues', 'Top bar', 'Translations view']);
    expect(within(tour()).getByText('7 of 7')).toBeInTheDocument();
    expect(within(tour()).queryByRole('button', { name: 'Skip tour' })).not.toBeInTheDocument();

    await user.click(within(tour()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Workspace tour' })).not.toBeInTheDocument();
    expect(loadTourSeen()).toBe(true);
  });

  it('lists what each area can do', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await next(user);
    expect(features()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Add an attribute, a group or a list of objects from the Add menu/),
        expect.stringMatching(/^Right-click an item/),
        'Drag the handle beside an item to reorder it, or drop it on the middle of a group to move it inside. Dragging a selected item moves the whole selection.',
        'On a selected item, N adds, Del deletes, Ctrl+G groups and Alt+↑ Alt+↓ move it. Ctrl+Z undoes any change.',
      ]),
    );
    expect(keys()).toEqual(['N', 'Del', 'Ctrl+G', 'Alt+↑', 'Alt+↓', 'Ctrl+Z', 'Ctrl+F']);
    await next(user);
    expect(within(tour()).getByText('{{', { selector: 'kbd' })).toBeInTheDocument();
    // The translations and the wallet preview live in the Edit pane now.
    expect(features().join(' ')).not.toMatch(/Translations panel/);
    expect(features()).toEqual(
      expect.arrayContaining([
        'With several languages, each text lists every language, the editing language first. Empty ones are yellow.',
        expect.stringMatching(/^Texts filled in for you, from I14Y for example, are marked for review/),
        expect.stringMatching(/^The preview shows the card, the details screen or the home list row, for iOS or Android. It sits beside the form/),
      ]),
    );

    // Output gives the bundle to publish; the issues have a step of their own.
    await next(user);
    expect(features().join(' ')).not.toMatch(/issue|preview|divider|gear/i);
    expect(features()).toEqual(
      expect.arrayContaining([expect.stringMatching(/Above it, choose where the bundle will be hosted/), expect.stringMatching(/^Attach a sample credential there too/)]),
    );
    expect(keys()).toEqual(['Ctrl+Alt+B']);
    await next(user);
    expect(heading()).toBe('Issues');
    expect(features()).toContain('Click an issue to jump to its field.');
  });

  it('shows the shortcut keys with ⌘ and ⌥ on a Mac', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const user = userEvent.setup();
    render(<Workspace />);
    await next(user);
    expect(keys()).toEqual(['N', '⌫', '⌘G', '⌥↑', '⌥↓', '⌘Z', '⌘F']);
    await next(user, 2);
    expect(keys()).toEqual(['⌥⌘B']);
  });

  it('lights up the form and the wallet preview beside it for the Edit step', async () => {
    layOut('edit');
    const user = userEvent.setup();
    render(<Workspace />);
    await next(user);
    expect(document.querySelector('.tour__spotlight')).not.toBeInTheDocument();
    await next(user);
    expect(heading()).toBe('Edit');
    const edit = screen.getByRole('region', { name: 'Edit' });
    expect(edit).toHaveAttribute('data-tour', 'edit');
    expect(within(edit).getByLabelText('Name')).toBeInTheDocument();
    expect(within(edit).getByRole('region', { name: 'Preview' })).toBeInTheDocument();
    expect(document.querySelector('.tour__spotlight')).toBeInTheDocument();
  });

  it('switches a narrow window to the Edit tab for its step, with the form and the preview', async () => {
    narrowWindow();
    const user = userEvent.setup();
    render(<Workspace />);
    await next(user);
    expect(shownPane()).toBe('Structure');
    await next(user);
    expect(heading()).toBe('Edit');
    expect(shownPane()).toBe('Edit');
    const edit = screen.getByRole('region', { name: 'Edit' });
    expect(within(edit).getByLabelText('Name')).toBeInTheDocument();
    expect(within(edit).getByRole('region', { name: 'Preview' })).toBeInTheDocument();
  });

  it('lights up the Issues panel along the bottom for its step', async () => {
    layOut('issues');
    const user = userEvent.setup();
    render(<Workspace />);
    await next(user, 3);
    expect(document.querySelector('.tour__spotlight')).not.toBeInTheDocument();
    await next(user);
    expect(heading()).toBe('Issues');
    expect(screen.getByRole('region', { name: 'Issues' })).toHaveAttribute('data-tour', 'issues');
    expect(document.querySelector('.tour__spotlight')).toBeInTheDocument();
  });

  it('switches a narrow window to the Issues tab for its step and back when done', async () => {
    narrowWindow();
    const user = userEvent.setup();
    render(<Workspace />);
    expect(shownPane()).toBe('Edit');
    expect(screen.queryByRole('region', { name: 'Issues' })).not.toBeInTheDocument();
    await next(user, 3);
    expect(shownPane()).toBe('Output');
    await next(user);
    expect(heading()).toBe('Issues');
    expect(shownPane()).toBe('Issues');
    expect(screen.getByRole('region', { name: 'Issues' })).toBeInTheDocument();

    await user.click(within(tour()).getByRole('button', { name: 'Back' }));
    expect(shownPane()).toBe('Output');
    await next(user);
    await user.click(within(tour()).getByRole('button', { name: 'Skip tour' }));
    expect(shownPane()).toBe('Edit');
    expect(screen.queryByRole('region', { name: 'Issues' })).not.toBeInTheDocument();
  });

  it('shows the translations table for its step and puts the view and pane back when done', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    expect(shownPane()).toBe('Edit');
    await user.click(within(tour()).getByRole('button', { name: 'Next' }));
    expect(shownPane()).toBe('Structure');
    await user.click(within(tour()).getByRole('button', { name: 'Next' }));
    await user.click(within(tour()).getByRole('button', { name: 'Next' }));
    expect(shownPane()).toBe('Output');
    await next(user, 3);
    expect(useStore.getState().view).toBe('translations');
    expect(screen.getByRole('table')).toBeInTheDocument();

    await user.click(within(tour()).getByRole('button', { name: 'Back' }));
    expect(useStore.getState().view).toBe('editor');
    await user.click(within(tour()).getByRole('button', { name: 'Next' }));
    await user.click(within(tour()).getByRole('button', { name: 'Done' }));
    expect(useStore.getState().view).toBe('editor');
    expect(shownPane()).toBe('Edit');
  });

  it('shows the Output pane for its step when it was hidden', async () => {
    localStorage.setItem(OUTPUT_OPEN_KEY, 'false');
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    await next(user, 3);
    expect(heading()).toBe('Output');
    expect(screen.getByRole('region', { name: 'Output' })).toBeInTheDocument();
    expect(localStorage.getItem(OUTPUT_OPEN_KEY)).toBe('true');

    // Hidden again during the tour (by the shortcut, say), coming back to the step shows it again.
    act(() => useStore.getState().setOutputOpen(false));
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    await next(user);
    await user.click(within(tour()).getByRole('button', { name: 'Back' }));
    expect(heading()).toBe('Output');
    expect(screen.getByRole('region', { name: 'Output' })).toBeInTheDocument();
  });

  it('moves with the arrow keys, keeps Tab on the card and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(heading()).toBe('Edit');
    await user.keyboard('{ArrowLeft}');
    expect(heading()).toBe('Structure');

    expect(within(tour()).getByRole('button', { name: 'Next' })).toHaveFocus();
    await user.tab();
    expect(within(tour()).getByRole('button', { name: 'Skip tour' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(tour()).getByRole('button', { name: 'Next' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Workspace tour' })).not.toBeInTheDocument();
    expect(loadTourSeen()).toBe(true);
  });

  it('stays closed once seen and replays from the menu', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.queryByRole('dialog', { name: 'Workspace tour' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Take the tour' }));
    expect(heading()).toBe('Welcome to the workspace');

    // Focus goes back to the menu button that opened the tour, not to the page.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus();
  });

  it('starts from the translations view and returns to it', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    useStore.getState().setView('translations');
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Take the tour' }));
    await user.click(within(tour()).getByRole('button', { name: 'Next' }));
    expect(useStore.getState().view).toBe('editor');
    await user.click(within(tour()).getByRole('button', { name: 'Skip tour' }));
    expect(useStore.getState().view).toBe('translations');
  });
});
