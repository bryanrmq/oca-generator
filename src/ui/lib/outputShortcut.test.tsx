// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../../core/model';
import { useStore } from '../../state/store';
import { Workspace } from '../workspace/Workspace';
import { command, matchesKeys } from './commands';
import { OUTPUT_OPEN_KEY } from './paneLayout';
import { TOUR_SEEN_KEY } from './tour';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', ...init });
const press = (init: KeyboardEventInit = { metaKey: true, altKey: true }) => fireEvent.keyDown(document, { code: 'KeyB', key: '∫', ...init });
const isOutputToggle = (event: KeyboardEvent) => matchesKeys(command('workspace.toggleOutput').keys!, event);
const output = () => screen.queryByRole('region', { name: 'Output' });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  useStore.getState().close();
  useStore.getState().load(emptyProject(['de-CH', 'en-GB']));
});

afterEach(() => vi.unstubAllGlobals());

describe('output shortcut', () => {
  it('matches ⌥⌘B and Ctrl+Alt+B by the physical key only', () => {
    expect(isOutputToggle(key({ metaKey: true, altKey: true, key: '∫' }))).toBe(true);
    expect(isOutputToggle(key({ ctrlKey: true, altKey: true }))).toBe(true);
    expect(isOutputToggle(key({ metaKey: true }))).toBe(false);
    expect(isOutputToggle(key({ altKey: true }))).toBe(false);
    expect(isOutputToggle(key({ metaKey: true, altKey: true, shiftKey: true }))).toBe(false);
    expect(isOutputToggle(key({ metaKey: true, altKey: true, code: 'KeyN' }))).toBe(false);
  });

  it('hides and shows the Output pane from anywhere, leaving focus where it was', () => {
    const { container } = render(<Workspace />);
    const toggle = within(container.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name: 'Hide output' });
    expect(toggle).toHaveAttribute('title', 'Hide output (⌥⌘B)');
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Meta+Alt+B Control+Alt+B');
    const field = screen.getByLabelText('Name');
    field.focus();
    press();
    expect(output()).not.toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(localStorage.getItem(OUTPUT_OPEN_KEY)).toBe('false');
    press({ ctrlKey: true, altKey: true });
    expect(output()).toBeInTheDocument();
  });

  it('moves focus to the top-bar toggle when it hides the pane focus was in', () => {
    const { container } = render(<Workspace />);
    within(output()!).getByRole('tab', { name: 'Bundle' }).focus();
    press();
    expect(output()).not.toBeInTheDocument();
    expect(within(container.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name: 'Show output' })).toHaveFocus();
  });

  it('does nothing on a narrow window or while the tour is open', () => {
    useStore.getState().setTourOpen(true);
    const { unmount } = render(<Workspace />);
    press();
    expect(useStore.getState().outputOpen).toBe(true);
    unmount();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    useStore.getState().setTourOpen(false);
    render(<Workspace />);
    press();
    expect(useStore.getState().outputOpen).toBe(true);
  });
});
