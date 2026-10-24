// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject, newAttribute } from '../../core/model';
import { useDrafts } from '../../state/persistence';
import { useStore } from '../../state/store';
import { OUTPUT_OPEN_KEY, PANE_LAYOUT_KEY } from '../lib/paneLayout';
import { TOUR_SEEN_KEY } from '../lib/tour';
import { Workspace } from './Workspace';

function loadProject() {
  const project = emptyProject(['de-CH', 'en-GB']);
  project.meta['de-CH'] = { name: 'Hundebewilligung', description: 'Für Hundehalter' };
  project.root.children.push(
    newAttribute('name', { source: ['name'], labels: { 'de-CH': 'Name' } }),
    newAttribute('broken', { source: [] }),
  );
  useStore.getState().load(project);
}

/** The top bar; the Edit pane's header is a banner too. */
const topBar = () => within(document.querySelector<HTMLElement>('.topbar')!);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  loadProject();
});

describe('Workspace', () => {
  it('blocks the download while there are errors and links issues to fields', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    expect(within(screen.getByRole('region', { name: 'Issues' })).getByText('1 error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download bundle' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /"broken" has no source path/ }));
    expect(screen.getByLabelText('Key')).toHaveValue('broken');
    await user.type(screen.getByLabelText('Source path'), 'broken');
    expect(screen.queryByText('1 error')).not.toBeInTheDocument();
  });

  it('edits the credential name in the current language', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(within(screen.getByRole('group', { name: 'Editing language' })).getByRole('button', { name: 'en-GB' }));
    await user.type(screen.getByLabelText('Name'), 'Dog permit');
    expect(useStore.getState().project?.meta['en-GB'].name).toBe('Dog permit');
    expect(useStore.getState().project?.meta['de-CH'].name).toBe('Hundebewilligung');
  });

  it('fills labels in the translations table', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Translations' }));
    await user.type(screen.getByLabelText('name Label (en-GB)'), 'Name');
    const name = useStore.getState().project?.root.children[0];
    expect(name?.labels).toEqual({ 'de-CH': 'Name', 'en-GB': 'Name' });
  });

  it('adds a language from the languages dialog', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Manage languages' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /French/ }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(useStore.getState().project?.languages).toEqual(['de-CH', 'en-GB', 'fr-CH']);
    expect(within(screen.getByRole('group', { name: 'Editing language' })).getByRole('button', { name: 'fr-CH' })).toBeInTheDocument();
  });

  it('shows the out-of-space banner while the draft cannot be saved', () => {
    useStore.getState().setDraftSaveFailed(true);
    render(<Workspace />);
    const banner = screen.getByText(/This browser is out of space/).closest('[role="status"]')!;
    expect(banner).toHaveClass('space-banner');
    // A project file keeps the project as it is, errors included.
    expect(within(banner as HTMLElement).getByRole('button', { name: 'Save project file' })).toBeEnabled();
    act(() => useStore.getState().setDraftSaveFailed(false));
    expect(screen.queryByText(/This browser is out of space/)).not.toBeInTheDocument();
  });

  it('says so when the browser has no storage', () => {
    useDrafts.setState({ available: false });
    render(<Workspace />);
    expect(screen.getByText(/does not allow local storage/)).toHaveAttribute('role', 'status');
    useDrafts.setState({ available: true });
  });

  it('attaches a sample credential and checks source paths against it', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Attach sample' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Paste JSON/));
    await user.paste('{"given_name": "Seraina"}');
    await user.click(within(dialog).getByRole('button', { name: 'Attach' }));

    expect(useStore.getState().project?.sample).toEqual({ given_name: 'Seraina' });
    expect(screen.getByText('The source path of "name" does not exist in the sample credential.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove sample' }));
    expect(useStore.getState().project?.sample).toBeUndefined();
  });

  it('refuses a sample that is not a claims object', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Attach sample' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Paste JSON/));
    await user.paste('[1, 2]');
    await user.click(within(dialog).getByRole('button', { name: 'Attach' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The sample credential must be a JSON object of claims.');
    expect(useStore.getState().project?.sample).toBeUndefined();
  });

  it('lists an issue once with a chip per language', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const row = screen.getByRole('button', { name: '"broken" has no label.' }).closest('li')!;
    expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['"broken" has no label.', 'de-CH', 'en-GB']);

    await user.click(within(row).getByRole('button', { name: 'en-GB' }));
    expect(useStore.getState().editLang).toBe('en-GB');
    expect(useStore.getState().selection).toMatchObject({ kind: 'node' });
  });

  it('returns to the start screen from the menu without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'New project' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('closes the menu with Escape', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('fills an empty structure from a sample', async () => {
    const project = emptyProject(['de-CH']);
    project.meta['de-CH'] = { name: 'Hundebewilligung', description: '' };
    useStore.getState().load(project);
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.getByText('No attributes yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fill from a sample' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Paste JSON/));
    await user.paste('{"iss": "did:example", "given_name": "Seraina", "address": {"city": "Bern"}}');
    await user.click(within(dialog).getByRole('button', { name: 'Fill' }));

    const state = useStore.getState();
    expect(state.project?.root.children.map((child) => child.key)).toEqual(['given_name', 'address']);
    expect(state.project?.sample).toEqual({ iss: 'did:example', given_name: 'Seraina', address: { city: 'Bern' } });
    expect(state.project?.meta['de-CH'].name).toBe('Hundebewilligung');
    expect(screen.getByText('Skipped technical claims: iss.')).toBeInTheDocument();
  });

  it('adds the first attribute from the empty state', async () => {
    useStore.getState().load(emptyProject(['de-CH']));
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Add attribute' }));
    expect(useStore.getState().project?.root.children.map((child) => child.key)).toEqual(['attribute']);
  });

  it('shows the selected item in every language inside the form, with no Translations column', async () => {
    const user = userEvent.setup();
    const nameNode = useStore.getState().project!.root.children[0];
    useStore.getState().select({ kind: 'node', id: nameNode.id });
    render(<Workspace />);
    expect(screen.queryByRole('complementary', { name: 'Translations' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toHaveValue('Name');
    const english = screen.getByLabelText('Label (en-GB)');
    expect(english).toHaveAttribute('data-empty', 'true');

    await user.type(english, 'Name');
    expect(useStore.getState().project?.root.children[0].labels).toEqual({ 'de-CH': 'Name', 'en-GB': 'Name' });

    await user.click(within(topBar().getByRole('group', { name: 'Editing language' })).getByRole('button', { name: 'en-GB' }));
    expect(screen.getByLabelText('Label')).toHaveValue('Name');
    expect(screen.getByLabelText('Label (de-CH)')).toHaveValue('Name');
  });

  it('shows the credential texts in every language when the credential is selected', () => {
    render(<Workspace />);
    expect(screen.getByLabelText('Name')).toHaveValue('Hundebewilligung');
    expect(screen.getByLabelText('Name (en-GB)')).toHaveValue('');
    expect(screen.getByLabelText('Description (en-GB)')).toHaveValue('');
    expect(screen.getByLabelText('Primary field (en-GB)')).toHaveValue('');
  });

  it('shows a single input per text for a single-language project', () => {
    useStore.getState().load(emptyProject(['de-CH']));
    render(<Workspace />);
    expect(screen.queryByRole('complementary', { name: 'Translations' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByText('de-CH', { selector: '.lang-row__code' })).not.toBeInTheDocument();
  });

  it('heads the inspector with the label, the technical key and the editing language', () => {
    const nameNode = useStore.getState().project!.root.children[0];
    useStore.getState().select({ kind: 'node', id: nameNode.id });
    render(<Workspace />);
    const header = screen.getByRole('heading', { level: 1, name: 'Name' }).closest('header')!;
    expect(within(header).getByText('name', { selector: 'code' })).toBeInTheDocument();
    expect(within(header).getByText('de-CH')).toBeInTheDocument();
  });

  it('resizes panes with the keyboard and remembers the widths', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Workspace />);
    const structure = screen.getByRole('separator', { name: 'Resize the structure pane' });
    expect(structure).toHaveAttribute('aria-valuenow', '300');
    structure.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(structure).toHaveAttribute('aria-valuenow', '332');
    const output = screen.getByRole('separator', { name: 'Resize the output pane' });
    output.focus();
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(output).toHaveAttribute('aria-valuenow', '484');

    unmount();
    render(<Workspace />);
    expect(screen.getByRole('separator', { name: 'Resize the structure pane' })).toHaveAttribute('aria-valuenow', '332');
    expect(screen.getByRole('separator', { name: 'Resize the output pane' })).toHaveAttribute('aria-valuenow', '484');
  });

  it('resizes a pane by dragging its handle and resets it with a double-click', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const structure = screen.getByRole('separator', { name: 'Resize the structure pane' });
    fireEvent.pointerDown(structure, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(structure, { clientX: 360, pointerId: 1 });
    fireEvent.pointerUp(structure, { clientX: 360, pointerId: 1 });
    expect(structure).toHaveAttribute('aria-valuenow', '360');
    expect(JSON.parse(localStorage.getItem(PANE_LAYOUT_KEY)!)).toEqual({ structure: 360, output: 420 });

    await user.dblClick(structure);
    expect(structure).toHaveAttribute('aria-valuenow', '300');
  });

  it('hides the Output pane from its header or the top bar and shows it again from the top bar', async () => {
    const user = userEvent.setup();
    const { container } = render(<Workspace />);
    expect(topBar().getByRole('button', { name: 'Hide output' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(screen.getByRole('region', { name: 'Output' })).getByRole('button', { name: 'Hide output' }));
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize the output pane' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Edit' })).toBeInTheDocument();
    expect(container.querySelector('.panes')).toHaveClass('panes--no-output');
    // Focus moves from the button that went away to the toggle that brings the pane back.
    const show = topBar().getByRole('button', { name: 'Show output' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    expect(show).toHaveFocus();

    await user.click(show);
    expect(screen.getByRole('region', { name: 'Output' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize the output pane' })).toBeInTheDocument();
    expect(container.querySelector('.panes')).not.toHaveClass('panes--no-output');

    await user.click(topBar().getByRole('button', { name: 'Hide output' }));
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
  });

  it('remembers that the Output pane is hidden', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Workspace />);
    await user.click(topBar().getByRole('button', { name: 'Hide output' }));
    expect(localStorage.getItem(OUTPUT_OPEN_KEY)).toBe('false');

    unmount();
    render(<Workspace />);
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    expect(topBar().getByRole('button', { name: 'Show output' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the hidden Output pane to go to a hosting issue', async () => {
    localStorage.setItem(OUTPUT_OPEN_KEY, 'false');
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();

    const issues = screen.getByRole('region', { name: 'Issues' });
    await user.click(within(issues).getByRole('button', { name: /Enter the URL where you will publish the bundle/ }));
    const output = screen.getByRole('region', { name: 'Output' });
    expect(within(output).getByRole('textbox', { name: 'At a URL I host' })).toBeInTheDocument();
    expect(localStorage.getItem(OUTPUT_OPEN_KEY)).toBe('true');
  });

  it('fixes an issue from the Issues panel', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const panel = screen.getByRole('region', { name: 'Issues' });
    await user.click(within(panel).getByRole('button', { name: 'Set source to broken' }));
    expect(screen.queryByText('1 error')).not.toBeInTheDocument();
    expect(useStore.getState().project!.root.children[1].source).toEqual(['broken']);
  });

  it('offers the same fix under the field', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: /"broken" has no source path/ }));
    const inspector = screen.getByRole('region', { name: 'Edit' });
    await user.click(within(inspector).getByRole('button', { name: 'Set source to broken' }));
    expect(screen.getByLabelText('Source path')).toHaveValue('broken');
    expect(within(inspector).queryByText(/has no source path/)).not.toBeInTheDocument();
  });

  it('fixes every issue that has a single fix at once', async () => {
    const user = userEvent.setup();
    useStore.getState().update((draft) => {
      draft.root.children.push(
        newAttribute('a b', { source: ['ab'], labels: { 'de-CH': 'AB' } }),
        newAttribute('when', { type: 'DateTime', source: ['when'], labels: { 'de-CH': 'Wann' } }),
      );
    });
    render(<Workspace />);
    const panel = screen.getByRole('region', { name: 'Issues' });
    await user.click(within(panel).getByRole('button', { name: 'Fix all (2)' }));
    expect(useStore.getState().project!.root.children.map((node) => node.key)).toEqual(['name', 'broken', 'a_b', 'when']);
    expect(useStore.getState().project!.root.children[1].source).toEqual(['broken']);
    expect(within(panel).getByRole('button', { name: 'Use ISO 8601' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Use Unix time' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Fix all/ })).not.toBeInTheDocument();
  });

  it('fixes a language tag from the languages dialog', async () => {
    const user = userEvent.setup();
    useStore.getState().load(emptyProject(['de-CH', 'fr']));
    useStore.getState().setLanguagesOpen(true);
    render(<Workspace />);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename to "fr-CH"' }));
    expect(useStore.getState().project!.languages).toEqual(['de-CH', 'fr-CH']);
    useStore.getState().setLanguagesOpen(false);
  });

  it('undoes a fix from the toast', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(within(screen.getByRole('region', { name: 'Issues' })).getByRole('button', { name: 'Set source to broken' }));
    expect(screen.getByText('Fixed 1 issue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(screen.getByRole('region', { name: 'Issues' })).getByText('1 error')).toBeInTheDocument();
    expect(screen.queryByText('Fixed 1 issue')).not.toBeInTheDocument();
  });

  it('shows a fix under a field only when the issue of that field has one', async () => {
    const user = userEvent.setup();
    useStore.getState().update((draft) => {
      draft.branding['de-CH'].light.primaryBackgroundColor = '#abc';
      draft.branding['en-GB'].light.primaryBackgroundColor = 'red';
    });
    useStore.getState().select({ kind: 'credential' });
    useStore.getState().setBrandingTheme('light');
    render(<Workspace />);
    const inspector = screen.getByRole('region', { name: 'Edit' });
    expect(within(inspector).getByRole('button', { name: 'Use "#AABBCC"' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Editing language' })).getByRole('button', { name: 'en-GB' }));
    expect(within(inspector).getByText(/background colour must look like/)).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Use "#AABBCC"' })).not.toBeInTheDocument();
  });

});

describe('Output pane on a narrow window', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays one of the pane tabs, without a toggle, even when hidden on a wide window', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    localStorage.setItem(OUTPUT_OPEN_KEY, 'false');
    const user = userEvent.setup();
    const { container } = render(<Workspace />);
    expect(topBar().queryByRole('button', { name: /output/ })).not.toBeInTheDocument();
    expect(container.querySelector('.panes')).not.toHaveClass('panes--no-output');

    await user.click(within(screen.getByRole('tablist', { name: 'Panes' })).getByRole('tab', { name: 'Output' }));
    const output = screen.getByRole('region', { name: 'Output' });
    expect(within(output).queryByRole('button', { name: 'Hide output' })).not.toBeInTheDocument();
  });
});
