// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LangTag, emptyProject } from '../../core/model';
import { serializeProjectFile } from '../../core/projectFile';
import { getDraft, initDrafts, restoreDraft, useDrafts } from '../../state/persistence';
import { useStore } from '../../state/store';
import { FixToast } from '../components/FixToast';
import { downloadText } from '../lib/download';
import { RecentProjects } from './RecentProjects';

vi.mock(import('../lib/download'), async (original) => ({ ...(await original()), downloadText: vi.fn() }));

const MINUTE = 60_000;

/** Stores a draft named `name` (none for an untitled one), last saved `minutesAgo` minutes ago. */
async function store(id: string, name: string, minutesAgo: number, options: { customName?: string; languages?: LangTag[] } = {}) {
  const project = emptyProject(options.languages ?? ['de-CH']);
  project.meta[project.languages[0]].name = name;
  await restoreDraft({ id, updatedAt: Date.now() - minutesAgo * MINUTE, project, ...(options.customName && { customName: options.customName }) });
}

function renderRecent() {
  return render(
    <>
      <RecentProjects />
      <FixToast />
    </>,
  );
}

const section = () => screen.getByRole('region', { name: 'Recent projects' });
/** The rows' open buttons, top to bottom. */
const rows = () => within(section()).getAllByRole('listitem').map((row) => row.querySelector<HTMLElement>('.recent__open')!);
const names = () => within(section()).getAllByRole('listitem').map((row) => row.querySelector('.recent__name')?.textContent);
const row = (name: string) => within(section()).getByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  await initDrafts();
  useStore.getState().close();
  vi.mocked(downloadText).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('RecentProjects', () => {
  it('is not shown without drafts', () => {
    renderRecent();
    expect(screen.queryByRole('region', { name: 'Recent projects' })).not.toBeInTheDocument();
  });

  it('lists the drafts newest first, with name, languages and when they were edited', async () => {
    await store('old', 'Lernfahrausweis', 3 * 24 * 60);
    await store('new', 'Hundebewilligung', 2, { languages: ['de-CH', 'fr-CH', 'it-CH'] });
    await store('named', 'Fischereipatent', 30, { customName: 'Fishing permit' });
    renderRecent();

    expect(names()).toEqual(['Hundebewilligung', 'Fishing permit', 'Lernfahrausweis']);
    const newest = within(section()).getAllByRole('listitem')[0];
    expect(newest).toHaveTextContent('de-CH fr-CH it-CH');
    const time = newest.querySelector('time')!;
    expect(time).toHaveTextContent('2 min ago');
    expect(time.title).toMatch(/\d{4}, \d{2}:\d{2}$/);
  });

  it('shows an untitled draft as "Untitled credential", muted', async () => {
    await store('blank', '', 1);
    renderRecent();
    expect(within(section()).getByText('Untitled credential')).toHaveClass('recent__name--untitled');
  });

  it('opens a draft when its row is clicked or Enter is pressed on it', async () => {
    await store('a', 'Hundebewilligung', 1);
    await store('b', 'Lernfahrausweis', 2);
    const user = userEvent.setup();
    renderRecent();

    await user.click(row('Hundebewilligung'));
    await waitFor(() => expect(useStore.getState().draftId).toBe('a'));

    row('Lernfahrausweis').focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(useStore.getState().draftId).toBe('b'));
  });

  it('opens a project file as a new draft', async () => {
    await store('a', 'Hundebewilligung', 1);
    const opened = emptyProject(['de-CH']);
    opened.meta['de-CH'].name = 'Fischereipatent';
    const file = new File([serializeProjectFile(opened)], 'fischereipatent.credential-project.json', { type: 'application/json' });
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [file] });
      this.dispatchEvent(new Event('change'));
    });
    const user = userEvent.setup();
    renderRecent();

    await user.click(within(section()).getByRole('button', { name: 'Open project file' }));
    await waitFor(() => expect(useStore.getState().project?.meta['de-CH'].name).toBe('Fischereipatent'));
    expect(useStore.getState().draftId).not.toBe('a');
  });

  it('downloads a draft as a project file from its menu', async () => {
    await store('a', 'Hundebewilligung', 1);
    const user = userEvent.setup();
    renderRecent();

    await user.click(screen.getByRole('button', { name: 'Actions for Hundebewilligung' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download project file' }));
    await waitFor(() => expect(downloadText).toHaveBeenCalledOnce());
    const record = await getDraft('a');
    expect(downloadText).toHaveBeenCalledWith('hundebewilligung.credential-project.json', serializeProjectFile(record!.project));
  });

  describe('rename', () => {
    it('renames inline from the menu: Enter commits and the row keeps its place and focus', async () => {
      await store('a', 'Hundebewilligung', 1);
      await store('b', 'Lernfahrausweis', 2);
      const user = userEvent.setup();
      renderRecent();

      await user.click(screen.getByRole('button', { name: 'Actions for Lernfahrausweis' }));
      await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
      const input = screen.getByRole('textbox', { name: 'Rename Lernfahrausweis' });
      expect(input).toHaveFocus();
      expect(input).toHaveValue('Lernfahrausweis');
      await user.clear(input);
      await user.type(input, 'Learner permit{Enter}');

      await waitFor(() => expect(names()).toEqual(['Hundebewilligung', 'Learner permit']));
      expect(row('Learner permit')).toHaveFocus();
      expect((await getDraft('b'))?.customName).toBe('Learner permit');
    });

    it('starts with F2, commits on blur and cancels with Escape', async () => {
      await store('a', 'Hundebewilligung', 1);
      const user = userEvent.setup();
      renderRecent();

      row('Hundebewilligung').focus();
      await user.keyboard('{F2}');
      await user.keyboard('{Control>}a{/Control}Dog permit{Escape}');
      expect(names()).toEqual(['Hundebewilligung']);
      expect(row('Hundebewilligung')).toHaveFocus();
      expect((await getDraft('a'))?.customName).toBeUndefined();

      await user.keyboard('{F2}');
      const input = screen.getByRole('textbox', { name: 'Rename Hundebewilligung' });
      await user.clear(input);
      await user.type(input, 'Dog permit');
      fireEvent.blur(input);
      await waitFor(() => expect(names()).toEqual(['Dog permit']));
    });

    it('names the draft after its credential again when the name is cleared', async () => {
      await store('a', 'Hundebewilligung', 1, { customName: 'Dog permit' });
      const user = userEvent.setup();
      renderRecent();

      row('Dog permit').focus();
      await user.keyboard('{F2}');
      await user.clear(screen.getByRole('textbox', { name: 'Rename Dog permit' }));
      await user.keyboard('{Enter}');
      await waitFor(() => expect(names()).toEqual(['Hundebewilligung']));
      expect((await getDraft('a'))?.customName).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes from the menu without asking, and Undo puts the draft back in its place', async () => {
      await store('a', 'Hundebewilligung', 1);
      await store('b', 'Lernfahrausweis', 2);
      await store('c', 'Fischereipatent', 3);
      const confirm = vi.spyOn(window, 'confirm');
      const user = userEvent.setup();
      renderRecent();

      await user.click(screen.getByRole('button', { name: 'Actions for Lernfahrausweis' }));
      await user.click(screen.getByRole('menuitem', { name: /Delete/ }));
      await waitFor(() => expect(names()).toEqual(['Hundebewilligung', 'Fischereipatent']));
      expect(confirm).not.toHaveBeenCalled();
      expect(await getDraft('b')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent("'Lernfahrausweis' deleted");

      await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(names()).toEqual(['Hundebewilligung', 'Lernfahrausweis', 'Fischereipatent']));
      expect((await getDraft('b'))?.project.meta['de-CH'].name).toBe('Lernfahrausweis');
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('deletes the focused row with ⌫ and moves focus to the row that took its place', async () => {
      await store('a', 'Hundebewilligung', 1);
      await store('b', 'Lernfahrausweis', 2);
      const user = userEvent.setup();
      renderRecent();

      row('Hundebewilligung').focus();
      await user.keyboard('{Backspace}');
      await waitFor(() => expect(names()).toEqual(['Lernfahrausweis']));
      expect(row('Lernfahrausweis')).toHaveFocus();
    });

    it('hides the section once the last draft is deleted, and Undo brings it back', async () => {
      await store('a', 'Hundebewilligung', 1);
      const user = userEvent.setup();
      renderRecent();

      row('Hundebewilligung').focus();
      await user.keyboard('{Delete}');
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Recent projects' })).not.toBeInTheDocument());
      await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(names()).toEqual(['Hundebewilligung']));
    });
  });

  it('shows the 8 most recent drafts until "Show all" is used', async () => {
    for (let index = 0; index < 10; index++) await store(`d${index}`, `Draft ${index}`, index + 1);
    const user = userEvent.setup();
    renderRecent();

    expect(names()).toEqual(['Draft 0', 'Draft 1', 'Draft 2', 'Draft 3', 'Draft 4', 'Draft 5', 'Draft 6', 'Draft 7']);
    await user.click(screen.getByRole('button', { name: 'Show all 10' }));
    expect(rows()).toHaveLength(10);
    expect(names().slice(-2)).toEqual(['Draft 8', 'Draft 9']);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  describe('row menu', () => {
    it('opens with ⇧F10 and the context-menu key on a row, and Escape gives focus back to the row', async () => {
      await store('a', 'Hundebewilligung', 1);
      const user = userEvent.setup();
      renderRecent();

      row('Hundebewilligung').focus();
      await user.keyboard('{Shift>}{F10}{/Shift}');
      const menu = screen.getByRole('menu', { name: 'Actions for Hundebewilligung' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['RenameF2', 'Download project file', expect.stringMatching(/^Delete(⌫|Del)$/)]);
      expect(within(menu).getByRole('menuitem', { name: /Rename/ })).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(row('Hundebewilligung')).toHaveFocus();

      await user.keyboard('{ContextMenu}');
      expect(screen.getByRole('menu', { name: 'Actions for Hundebewilligung' })).toBeInTheDocument();
    });

    it('opens on right-click, and its items work by keyboard', async () => {
      await store('a', 'Hundebewilligung', 1);
      await store('b', 'Lernfahrausweis', 2);
      const user = userEvent.setup();
      renderRecent();

      fireEvent.contextMenu(row('Lernfahrausweis'));
      expect(screen.getByRole('menu', { name: 'Actions for Lernfahrausweis' })).toBeInTheDocument();
      await user.keyboard('{End}{Enter}');
      await waitFor(() => expect(names()).toEqual(['Hundebewilligung']));
    });

    it('marks the actions button as expanded while its menu is open', async () => {
      await store('a', 'Hundebewilligung', 1);
      const user = userEvent.setup();
      renderRecent();

      const button = screen.getByRole('button', { name: 'Actions for Hundebewilligung' });
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      await user.keyboard('{Escape}');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveFocus();
    });
  });

  it('lists drafts stored after it showed', async () => {
    renderRecent();
    await store('a', 'Hundebewilligung', 1);
    await waitFor(() => expect(names()).toEqual(['Hundebewilligung']));
    expect(useDrafts.getState().drafts).toHaveLength(1);
  });
});
