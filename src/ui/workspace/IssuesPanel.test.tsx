// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGroup, emptyProject, ensureIssuer, newAttribute, newGroupLink } from '../../core/model';
import { oneNode } from '../../state/selection';
import { useStore } from '../../state/store';
import { ISSUES_HEIGHT_KEY, ISSUES_OPEN_KEY } from '../lib/paneLayout';
import { TOUR_SEEN_KEY } from '../lib/tour';
import { Workspace } from './Workspace';

/** A project with no issues at all. */
function cleanProject() {
  const project = emptyProject(['de-CH']);
  project.meta['de-CH'] = { name: 'Hundebewilligung', description: 'Für Hundehalter' };
  project.root.children.push(newAttribute('name', { source: ['name'], labels: { 'de-CH': 'Name' } }));
  project.hosting = { mode: 'dataUrl' };
  ensureIssuer(project).name['de-CH'] = 'Kanton Bern';
  return project;
}

/** `cleanProject()` plus one error and one warning. */
function brokenProject() {
  const project = cleanProject();
  project.root.children.push(newAttribute('broken', { source: [], labels: { 'de-CH': 'Kaputt' } }), newAttribute('unlabelled', { source: ['unlabelled'] }));
  return project;
}

/** Makes the window narrower than 1000 px, where the workspace shows one pane at a time. */
function narrowWindow() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

const panel = () => screen.getByRole('region', { name: 'Issues' });
const topBarButton = () => screen.getByRole('button', { name: /^Show issues/ });
const row = (summary: string | RegExp) => within(panel()).getByRole('button', { name: summary }).closest('li')!;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
});

describe('IssuesPanel', () => {
  it('says there are no issues when there are none', () => {
    useStore.getState().load(cleanProject());
    render(<Workspace />);
    expect(within(panel()).getByText('No issues')).toBeInTheDocument();
    expect(within(panel()).getByText('No issues. The bundle is ready.')).toBeInTheDocument();
    expect(within(panel()).queryByRole('list')).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Fix all/ })).not.toBeInTheDocument();
  });

  it('counts errors and warnings in the header', () => {
    const project = cleanProject();
    project.root.children.push(
      newAttribute('broken', { source: [], labels: { 'de-CH': 'Kaputt' } }),
      newAttribute('unlabelled', { source: ['unlabelled'] }),
      newAttribute('also', { source: ['also'] }),
    );
    useStore.getState().load(project);
    render(<Workspace />);
    expect(within(panel()).getByText('1 error')).toBeInTheDocument();
    expect(within(panel()).getByText('2 warnings')).toBeInTheDocument();
    expect(within(panel()).queryByText('No issues')).not.toBeInTheDocument();
    expect(within(panel()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('collapses to its header and expands again', async () => {
    const project = cleanProject();
    project.root.children.push(newAttribute('broken', { source: [], labels: { 'de-CH': 'Kaputt' } }));
    useStore.getState().load(project);
    const user = userEvent.setup();
    render(<Workspace />);
    const collapse = within(panel()).getByRole('button', { name: 'Collapse issues' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');

    await user.click(collapse);
    expect(within(panel()).queryByRole('list')).not.toBeInTheDocument();
    expect(within(panel()).getByText('1 error')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Fix all (1)' })).toBeInTheDocument();
    const expand = within(panel()).getByRole('button', { name: 'Expand issues' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await user.click(expand);
    expect(within(panel()).getByRole('list')).toBeInTheDocument();
  });

  it('remembers whether it is collapsed', async () => {
    useStore.getState().load(brokenProject());
    const user = userEvent.setup();
    const { unmount } = render(<Workspace />);
    await user.click(within(panel()).getByRole('button', { name: 'Collapse issues' }));
    expect(localStorage.getItem(ISSUES_OPEN_KEY)).toBe('false');

    unmount();
    render(<Workspace />);
    expect(within(panel()).getByRole('button', { name: 'Expand issues' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel()).queryByRole('list')).not.toBeInTheDocument();
  });

  it('resizes the list with the keyboard and remembers the height', async () => {
    useStore.getState().load(cleanProject());
    const user = userEvent.setup();
    const { unmount } = render(<Workspace />);
    const handle = within(panel()).getByRole('separator', { name: 'Resize the issues panel' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    handle.focus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(handle).toHaveAttribute('aria-valuenow', '232');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(handle).toHaveAttribute('aria-valuenow', '168');
    expect(document.getElementById('issues-panel-body')).toHaveStyle({ height: '168px' });

    unmount();
    render(<Workspace />);
    expect(within(panel()).getByRole('separator', { name: 'Resize the issues panel' })).toHaveAttribute('aria-valuenow', '168');
  });

  it('resizes the list by dragging its top edge and resets it with a double-click', async () => {
    useStore.getState().load(cleanProject());
    const user = userEvent.setup();
    render(<Workspace />);
    const handle = within(panel()).getByRole('separator', { name: 'Resize the issues panel' });
    fireEvent.pointerDown(handle, { clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 500, pointerId: 1 });
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(localStorage.getItem(ISSUES_HEIGHT_KEY)).toBe('300');

    await user.dblClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '200');
  });

  it('has no resize handle while collapsed', async () => {
    useStore.getState().load(cleanProject());
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(within(panel()).getByRole('button', { name: 'Collapse issues' }));
    expect(within(panel()).queryByRole('separator')).not.toBeInTheDocument();
  });

  it('jumps to the field when the row is clicked anywhere', async () => {
    const project = cleanProject();
    project.root.children.push(newAttribute('broken', { source: [], labels: { 'de-CH': 'Kaputt' } }));
    useStore.getState().load(project);
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(within(row(/"broken" has no source path/)).getByText('broken'));
    expect(useStore.getState().selection).toEqual(oneNode(project.root.children[1].id));
    expect(screen.getByLabelText('Key')).toHaveValue('broken');
  });

  it('shows where each issue sits', () => {
    const project = emptyProject(['de-CH', 'fr']);
    project.meta['de-CH'] = { name: 'Hundebewilligung', description: 'Für Hundehalter' };
    project.meta.fr = { name: 'Permis', description: 'Pour les chiens' };
    const address = newGroupLink('address', { source: ['address'], labels: { 'de-CH': 'Adresse', fr: 'Adresse' }, group: emptyGroup() });
    address.group.children.push(newAttribute('city', { source: [], labels: { 'de-CH': 'Ort', fr: 'Lieu' } }));
    project.root.children.push(address);
    project.hosting = { mode: 'url', url: 'not a url' };
    useStore.getState().load(project);
    render(<Workspace />);

    const locations = within(panel())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.issues__location')?.textContent);
    expect(locations).toContain('address.city');
    expect(locations).toContain('Languages');
    expect(locations).toContain('Hosting');
  });

  it('shows credential issues under "Credential"', () => {
    const project = cleanProject();
    project.meta['de-CH'].name = '';
    useStore.getState().load(project);
    render(<Workspace />);
    const item = within(panel()).getAllByRole('listitem')[0];
    expect(item.querySelector('.issues__location')).toHaveTextContent('Credential');
  });

  it('leaves the Output pane with the Bundle, VCT and Changes tabs, Bundle first', () => {
    useStore.getState().load(cleanProject());
    useStore.setState({ outputTab: 'bundle' });
    render(<Workspace />);
    const output = screen.getByRole('region', { name: 'Output' });
    const tabs = within(output).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Bundle', 'VCT snippet', 'Changes']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(useStore.getInitialState().outputTab).toBe('bundle');
  });
});

describe('top-bar issues button', () => {
  it('is not shown when there are no issues', () => {
    useStore.getState().load(cleanProject());
    render(<Workspace />);
    expect(screen.queryByRole('button', { name: /^Show issues/ })).not.toBeInTheDocument();
  });

  it('holds the error and warning pills', () => {
    useStore.getState().load(brokenProject());
    render(<Workspace />);
    expect(topBarButton()).toHaveAccessibleName('Show issues: 1 error, 1 warning');
    expect(within(topBarButton()).getByText('1 error')).toHaveClass('badge--red');
    expect(within(topBarButton()).getByText('1 warning')).toHaveClass('badge--yellow');
  });

  it('expands the collapsed panel and focuses its list', async () => {
    useStore.getState().load(brokenProject());
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(within(panel()).getByRole('button', { name: 'Collapse issues' }));

    await user.click(topBarButton());
    expect(within(panel()).getByRole('button', { name: 'Collapse issues' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel()).getByRole('list')).toHaveFocus();
    expect(localStorage.getItem(ISSUES_OPEN_KEY)).toBe('true');
  });
});

describe('IssuesPanel under the Translations view', () => {
  it('shows the issues and jumps to the field in the Editor view', async () => {
    const project = brokenProject();
    useStore.getState().load(project);
    useStore.getState().setView('translations');
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(within(panel()).getAllByRole('listitem')).toHaveLength(2);

    await user.click(within(panel()).getByRole('button', { name: /"broken" has no source path/ }));
    expect(useStore.getState().view).toBe('editor');
    expect(useStore.getState().selection).toMatchObject({ kind: 'node', id: project.root.children[1].id });
    expect(screen.getByLabelText('Key')).toHaveValue('broken');
  });
});

describe('Issues tab on a narrow window', () => {
  const panesTabs = () => within(screen.getByRole('tablist', { name: 'Panes' }));

  it('has no bottom panel and an Issues tab next to Structure, Edit and Output', async () => {
    narrowWindow();
    useStore.getState().load(brokenProject());
    const user = userEvent.setup();
    const { container } = render(<Workspace />);
    expect(screen.queryByRole('region', { name: 'Issues' })).not.toBeInTheDocument();
    expect(panesTabs().getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Structure', 'Edit', 'Output', 'Issues']);

    await user.click(panesTabs().getByRole('tab', { name: 'Issues' }));
    expect(container.querySelector('.panes')).toHaveAttribute('data-pane', 'issues');
    expect(within(panel()).getAllByRole('listitem')).toHaveLength(2);
    expect(within(panel()).queryByRole('separator')).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Collapse issues|Expand issues/ })).not.toBeInTheDocument();

    // Jumping to a field switches to the pane that holds it.
    await user.click(within(panel()).getByRole('button', { name: /"broken" has no source path/ }));
    expect(container.querySelector('.panes')).toHaveAttribute('data-pane', 'inspector');
    expect(screen.queryByRole('region', { name: 'Issues' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Key')).toHaveValue('broken');
  });

  it('shows the full list even when the docked panel was collapsed', async () => {
    narrowWindow();
    localStorage.setItem(ISSUES_OPEN_KEY, 'false');
    useStore.getState().load(brokenProject());
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(panesTabs().getByRole('tab', { name: 'Issues' }));
    expect(within(panel()).getByRole('list')).toBeInTheDocument();
  });

  it('opens from the top-bar button, from the Translations view too', async () => {
    narrowWindow();
    useStore.getState().load(brokenProject());
    useStore.getState().setView('translations');
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.queryByRole('region', { name: 'Issues' })).not.toBeInTheDocument();

    await user.click(topBarButton());
    expect(useStore.getState().view).toBe('editor');
    expect(panesTabs().getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByRole('list')).toHaveFocus();
  });
});
