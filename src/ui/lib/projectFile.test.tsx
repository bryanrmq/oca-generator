// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baseline } from '../../core/baseline';
import { type Project, emptyProject, newAttribute } from '../../core/model';
import { PROJECT_FILE_FORMAT, serializeProjectFile } from '../../core/projectFile';
import { createDraft, getDraft, initDrafts, restoreDraft, startAutosave, useDrafts } from '../../state/persistence';
import { useStore } from '../../state/store';
import { App } from '../App';
import { downloadText } from './download';
import { downloadDraftProjectFile, openProjectFile, openProjectFileFrom, saveProjectFile } from './projectFile';
import { TOUR_SEEN_KEY } from './tour';

vi.mock(import('./download'), async (original) => ({ ...(await original()), downloadText: vi.fn() }));

function project(name: string): Project {
  const result = emptyProject(['de-CH']);
  result.meta['de-CH'].name = name;
  result.root.children.push(
    newAttribute('canton', {
      i14y: { conceptId: 'c1', identifier: 'CH_CANTON', registrationStatus: 'Recorded', name: { de: 'Kanton' }, publisher: {}, values: {} },
    }),
  );
  result.sample = { canton: 'BE' };
  return result;
}

const baseline: Baseline = { json: '{"capture_bases":[]}', integrity: 'sha256-abc=', source: 'download', setAt: 5 };
const projectFile = (content: string) => new File([content], 'project.credential-project.json', { type: 'application/json' });
const ids = () => useDrafts.getState().drafts.map((draft) => draft.id);
const toast = () => document.querySelector('.toast--error');

/** Makes the next file picker choose `file`; returns the picker's input once it opened. */
function choose(file: File) {
  const picked: { input?: HTMLInputElement } = {};
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    picked.input = this;
    Object.defineProperty(this, 'files', { value: [file] });
    this.dispatchEvent(new Event('change'));
  });
  return picked;
}

let stop: () => void = () => {};

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  vi.stubGlobal('indexedDB', new IDBFactory());
  await initDrafts();
  useStore.getState().close();
  stop = startAutosave();
  vi.mocked(downloadText).mockClear();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe('saving a project file', () => {
  it('downloads the open project under its credential name', () => {
    const open = project('Hundebewilligung');
    createDraft(open);
    saveProjectFile();
    expect(downloadText).toHaveBeenCalledWith('hundebewilligung.credential-project.json', serializeProjectFile(open));
  });

  it('saves the open draft\'s baseline with it', () => {
    const open = project('Hundebewilligung');
    createDraft(open, undefined, { baseline });
    saveProjectFile();
    expect(downloadText).toHaveBeenCalledWith('hundebewilligung.credential-project.json', serializeProjectFile(open, baseline));
  });

  it('does nothing without an open project', () => {
    saveProjectFile();
    expect(downloadText).not.toHaveBeenCalled();
  });

  it('downloads a stored draft, for the start screen', async () => {
    const stored = project('Lernfahrausweis');
    await restoreDraft({ id: 'saved', updatedAt: 1, project: stored });
    expect(await downloadDraftProjectFile('saved')).toBe(true);
    expect(downloadText).toHaveBeenCalledWith('lernfahrausweis.credential-project.json', serializeProjectFile(stored));
    expect(await downloadDraftProjectFile('missing')).toBe(false);
    expect(downloadText).toHaveBeenCalledTimes(1);

    await restoreDraft({ id: 'published', updatedAt: 2, project: stored, baseline });
    await downloadDraftProjectFile('published');
    expect(downloadText).toHaveBeenLastCalledWith('lernfahrausweis.credential-project.json', serializeProjectFile(stored, baseline));
  });
});

describe('opening a project file', () => {
  it('opens the file as a new draft and keeps the one open before', async () => {
    const before = createDraft(project('Hundebewilligung'));
    await waitFor(() => expect(ids()).toEqual([before]));

    const opened = project('Lernfahrausweis');
    expect(await openProjectFileFrom(projectFile(serializeProjectFile(opened)))).toBe(true);

    const { draftId, project: open } = useStore.getState();
    expect(draftId).not.toBe(before);
    expect(open).toEqual(opened);
    await waitFor(() => expect(ids()).toHaveLength(2));
    expect(ids()).toContain(draftId);
    expect((await getDraft(before))?.project.meta['de-CH'].name).toBe('Hundebewilligung');
    expect((await getDraft(draftId!))?.project).toEqual(opened);
  });

  it('round-trips a saved project, the sample and I14Y links included', async () => {
    const saved = project('Hundebewilligung');
    createDraft(saved);
    saveProjectFile();
    const [, text] = vi.mocked(downloadText).mock.calls[0];
    await openProjectFileFrom(projectFile(text));
    expect(useStore.getState().project).toEqual(saved);
    expect(useStore.getState().project?.sample).toEqual({ canton: 'BE' });
    expect(useStore.getState().project?.root.children[0]).toMatchObject({ i14y: { identifier: 'CH_CANTON' } });
  });

  it('round-trips the baseline and stores it with the new draft', async () => {
    createDraft(project('Hundebewilligung'), undefined, { baseline });
    saveProjectFile();
    const [, text] = vi.mocked(downloadText).mock.calls[0];
    useStore.getState().close();
    await openProjectFileFrom(projectFile(text));
    expect(useStore.getState().baseline).toEqual(baseline);
    const { draftId } = useStore.getState();
    await waitFor(async () => expect((await getDraft(draftId!))?.baseline).toEqual(baseline));
  });

  it('opens a file saved without a baseline', async () => {
    const older = JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 1, project: project('Alt') });
    expect(await openProjectFileFrom(projectFile(older))).toBe(true);
    expect(useStore.getState().project?.meta['de-CH'].name).toBe('Alt');
    expect(useStore.getState().baseline).toBeNull();
  });

  it('shows an error for a file that is not a project, and keeps the open one', async () => {
    const before = createDraft(project('Hundebewilligung'));
    for (const text of ['not json', '{"format":"oca-bundle","version":1,"project":{}}', JSON.stringify(project('x'))]) {
      expect(await openProjectFileFrom(projectFile(text))).toBe(false);
      expect(useStore.getState().fixNotice).toEqual({ kind: 'error', message: "This file isn't a Credential Toolkit project." });
    }
    expect(useStore.getState().draftId).toBe(before);
  });

  it('shows an error for a file saved by a newer version', async () => {
    const text = JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 2, project: project('Neu') });
    expect(await openProjectFileFrom(projectFile(text))).toBe(false);
    expect(useStore.getState().fixNotice).toEqual({
      kind: 'error',
      message: 'This project was saved by a newer version of Credential Toolkit. Reload the page to update, then open it again.',
    });
    expect(useStore.getState().project).toBeNull();
  });

  it('asks for the file with the browser file picker', async () => {
    const picked = choose(projectFile(serializeProjectFile(project('Lernfahrausweis'))));
    openProjectFile();
    expect(picked.input?.type).toBe('file');
    expect(picked.input?.accept).toBe('.credential-project.json,.json,application/json');
    await waitFor(() => expect(useStore.getState().project?.meta['de-CH'].name).toBe('Lernfahrausweis'));
  });
});

describe('in the app', () => {
  /** Opens `open` in the app as a new draft, once it is stored. */
  async function openWorkspace(open = project('Hundebewilligung')) {
    render(<App />);
    act(() => void createDraft(open));
    await waitFor(() => expect(ids()).toHaveLength(1));
  }

  it('lists Save and Open after a separator, before New project, with their keys', async () => {
    const user = userEvent.setup();
    await openWorkspace();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    const keys = items.map((item) => item.getAttribute('aria-keyshortcuts') ?? '');
    const names = items.map((item) => item.firstChild?.textContent);
    expect(names.slice(-3)).toEqual(['Save project file', 'Open project file', 'New project']);
    expect(keys.slice(-3, -1)).toEqual([expect.stringMatching(/^(Meta|Control)\+S$/), expect.stringMatching(/^(Meta|Control)\+O$/)]);
    const separator = within(menu).getByRole('separator');
    expect(separator.nextElementSibling).toBe(within(menu).getByRole('menuitem', { name: 'Save project file' }));

    await user.click(within(menu).getByRole('menuitem', { name: 'Save project file' }));
    expect(downloadText).toHaveBeenCalledWith('hundebewilligung.credential-project.json', expect.stringContaining('"format": "credential-toolkit-project"'));

    const picked = choose(projectFile('nope'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open project file' }));
    expect(picked.input).toBeDefined();
    await waitFor(() => expect(toast()).toHaveTextContent("This file isn't a Credential Toolkit project."));
  });

  it('saves with ⌘S and opens with Ctrl+O, instead of the browser', async () => {
    await openWorkspace();
    const field = screen.getByLabelText('Name');
    expect(fireEvent.keyDown(field, { key: 's', metaKey: true })).toBe(false);
    expect(downloadText).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })).toBe(false);
    expect(downloadText).toHaveBeenCalledTimes(2);
    // ⇧⌘S is not ⌘S.
    expect(fireEvent.keyDown(document.body, { key: 's', metaKey: true, shiftKey: true })).toBe(true);
    expect(downloadText).toHaveBeenCalledTimes(2);

    const before = useStore.getState().draftId;
    choose(projectFile(serializeProjectFile(project('Lernfahrausweis'))));
    expect(fireEvent.keyDown(document.body, { key: 'o', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lernfahrausweis' })).toBeInTheDocument());
    expect(useStore.getState().draftId).not.toBe(before);
    expect(await getDraft(before!)).not.toBeNull();
  });

  it('saves the project file from the out-of-space banner, errors and all', async () => {
    const user = userEvent.setup();
    const broken = project('Hundebewilligung');
    broken.root.children.push(newAttribute('broken', { source: [] }));
    await openWorkspace(broken);
    expect(screen.getByRole('button', { name: 'Download bundle' })).toBeDisabled();
    act(() => useStore.getState().setDraftSaveFailed(true));
    const banner = screen.getByText(/This browser is out of space/).closest<HTMLElement>('[role="status"]')!;
    await user.click(within(banner).getByRole('button', { name: 'Save project file' }));
    expect(downloadText).toHaveBeenCalledWith('hundebewilligung.credential-project.json', serializeProjectFile(broken));
  });

  it('shows the error toast on the start screen too', async () => {
    render(<App />);
    await act(async () => void (await openProjectFileFrom(projectFile('{}'))));
    expect(toast()).toHaveTextContent("This file isn't a Credential Toolkit project.");
  });
});
