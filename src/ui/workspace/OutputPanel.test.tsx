// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject, newAttribute } from '../../core/model';
import { useStore } from '../../state/store';
import { TOUR_SEEN_KEY } from '../lib/tour';
import { Workspace } from './Workspace';

function loadProject(hosting: 'dataUrl' | 'emptyUrl' = 'dataUrl') {
  const project = emptyProject(['de-CH']);
  project.meta['de-CH'] = { name: 'Hundebewilligung', description: 'Für Hundehalter' };
  project.root.children.push(newAttribute('name', { source: ['name'], labels: { 'de-CH': 'Name' } }));
  project.hosting = hosting === 'dataUrl' ? { mode: 'dataUrl' } : { mode: 'url', url: '' };
  useStore.getState().load(project);
}

const output = () => within(screen.getByRole('region', { name: 'Output' }));
/** The JSON the pane shows: the bundle or the VCT snippet. */
const shownJson = () => screen.getByRole('region', { name: 'Output' }).querySelector('pre')!;
/** The hosting choice, shown above the JSON under the Bundle tab. */
const hosting = () => output().queryByRole('group', { name: 'Where will the bundle live?' });
/** Waits for the bundle to be built, which happens shortly after the project changes. */
const built = () => screen.findByText('uri#integrity');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  useStore.setState({ outputTab: 'bundle', cardPlatform: 'ios', cardVariant: 'detail' });
  loadProject();
});

describe('Output pane', () => {
  it('shows only the bundle, with no preview, divider or collapse control', async () => {
    render(<Workspace />);
    expect(output().getByRole('tablist', { name: 'Output' })).toBeInTheDocument();
    expect(output().queryByRole('figure')).not.toBeInTheDocument();
    expect(output().queryByRole('group', { name: 'Preview platform' })).not.toBeInTheDocument();
    expect(output().queryByRole('group', { name: 'Preview view' })).not.toBeInTheDocument();
    expect(output().queryByText('Preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize the preview' })).not.toBeInTheDocument();
    expect(output().queryByRole('button', { name: /^(Collapse|Expand)/ })).not.toBeInTheDocument();
    expect(output().queryByRole('button', { name: 'Bundle settings' })).not.toBeInTheDocument();
    expect(await built()).toBeInTheDocument();
    // The wallet preview is in the Edit pane.
    expect(within(screen.getByRole('region', { name: 'Edit' })).getByRole('region', { name: 'Preview' })).toBeInTheDocument();
  });

  it('neither reads nor writes the stored preview height or halves', async () => {
    localStorage.setItem('credential-toolkit:preview-height', '500');
    localStorage.setItem('credential-toolkit:output-halves', JSON.stringify({ preview: true, bundle: false }));
    const user = userEvent.setup();
    render(<Workspace />);
    // A bundle saved as collapsed shows all the same.
    expect(await built()).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Output' }).querySelector('.output')).not.toHaveAttribute('style');
    await user.click(output().getByRole('tab', { name: 'VCT snippet' }));
    await user.click(output().getByRole('tab', { name: 'Bundle' }));
    expect(localStorage.getItem('credential-toolkit:preview-height')).toBe('500');
    expect(localStorage.getItem('credential-toolkit:output-halves')).toBe(JSON.stringify({ preview: true, bundle: false }));
  });

  it('hides the pane with the button in its header on a wide window', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const header = screen.getByRole('region', { name: 'Output' }).querySelector<HTMLElement>('.output__header')!;
    expect(within(header).getByRole('tablist', { name: 'Output' })).toBeInTheDocument();
    const hide = within(header).getByRole('button', { name: 'Hide output' });
    expect(hide).toHaveAttribute('title', 'Hide output (⌥⌘B)');

    await user.click(hide);
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    expect(useStore.getState().outputOpen).toBe(false);
    expect(document.querySelector('.topbar [data-output-toggle]')).toHaveFocus();
  });
});

describe('Hosting and the sample credential', () => {
  it('shows them above the JSON under the Bundle tab, without opening a menu', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await built();
    const choice = within(hosting()!);
    expect(choice.getByRole('radio', { name: /Embedded as a data URL/ })).toBeChecked();
    expect(output().getByRole('button', { name: 'Attach sample' })).toBeInTheDocument();
    expect(hosting()!.compareDocumentPosition(shownJson()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(choice.getByRole('radio', { name: /At a URL I host/ }));
    await user.type(choice.getByRole('textbox', { name: 'At a URL I host' }), 'https://issuer.example.ch/oca.json');
    expect(useStore.getState().project!.hosting).toEqual({ mode: 'url', url: 'https://issuer.example.ch/oca.json' });
  });

  it('leaves them out of the VCT and Changes tabs', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(output().getByRole('tab', { name: 'VCT snippet' }));
    expect(hosting()).not.toBeInTheDocument();
    expect(output().queryByRole('button', { name: 'Attach sample' })).not.toBeInTheDocument();
    await user.click(output().getByRole('tab', { name: /^Changes/ }));
    expect(hosting()).not.toBeInTheDocument();
    await user.click(output().getByRole('tab', { name: 'Bundle' }));
    expect(hosting()).toBeInTheDocument();
  });

  it('switches to the Bundle tab to go to a hosting issue', async () => {
    loadProject('emptyUrl');
    useStore.setState({ outputTab: 'changes' });
    const user = userEvent.setup();
    render(<Workspace />);
    expect(output().queryByRole('textbox', { name: 'At a URL I host' })).not.toBeInTheDocument();

    const issues = screen.getByRole('region', { name: 'Issues' });
    await user.click(within(issues).getByRole('button', { name: /Enter the URL where you will publish the bundle/ }));
    expect(output().getByRole('tab', { name: 'Bundle' })).toHaveAttribute('aria-selected', 'true');
    expect(output().getByRole('textbox', { name: 'At a URL I host' })).toBeInTheDocument();
  });
});

describe('Bundle tab', () => {
  it('shows the size, copies what the tab shows and puts the integrity line under the JSON', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await built();
    expect(output().getByText(/^\d+\.\d KB$/)).toBeInTheDocument();
    const json = shownJson();
    const bundleText = json.textContent;
    const integrity = output().getByText('uri#integrity');
    expect(json.compareDocumentPosition(integrity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(output().getByRole('button', { name: 'Copy JSON' }));
    expect(await navigator.clipboard.readText()).toBe(bundleText);

    await user.click(output().getByRole('tab', { name: 'VCT snippet' }));
    expect(useStore.getState().outputTab).toBe('vct');
    const snippet = shownJson();
    expect(snippet.textContent).not.toBe(bundleText);
    const [entry] = JSON.parse(snippet.textContent!).display;
    expect(entry).toMatchObject({ lang: 'de-CH', name: 'Hundebewilligung', description: 'Für Hundehalter' });
    expect(entry).not.toHaveProperty('locale');
    await user.click(output().getByRole('button', { name: 'Copy snippet' }));
    expect(await navigator.clipboard.readText()).toBe(snippet.textContent);
    expect(output().getByText(/Add these entries to the "display" array/)).toBeInTheDocument();
  });
});

describe('Output pane on a narrow window', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the bundle with its hosting and no preview or hide button', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(within(screen.getByRole('tablist', { name: 'Panes' })).getByRole('tab', { name: 'Output' }));
    expect(output().getByRole('tablist', { name: 'Output' })).toBeInTheDocument();
    expect(hosting()).toBeInTheDocument();
    expect(output().queryByRole('figure')).not.toBeInTheDocument();
    expect(output().queryByRole('button', { name: 'Hide output' })).not.toBeInTheDocument();
    expect(await built()).toBeInTheDocument();
  });
});
