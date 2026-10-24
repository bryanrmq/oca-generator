// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baseline } from '../../core/baseline';
import { sriSha256, utf8 } from '../../core/cesr';
import { bundleDataUrl } from '../../core/export/outputs';
import { type Hosting, emptyProject } from '../../core/model';
import { useStore } from '../../state/store';
import bundle from '../../test/fixtures/oca-bundle-simple-sample.json';
import { FixToast } from '../components/FixToast';
import { LoadBaselineButton } from '../workspace/LoadBaselineButton';
import { chooseBaselineFile, hostingUrlOf, loadBaselineFromFile, loadBaselineFromUrl, setDownloadedBaseline } from './baseline';

const URL = 'https://issuer.example.ch/oca-bundle.json';
const text = `${JSON.stringify(bundle, null, 2)}\n`;
const BLOCKED = "The host doesn't allow this request. Download the bundle from your hosting and load it as a file.";
const INVALID = "This isn't a valid OCA bundle.";
const earlier: Baseline = { json: '{}', integrity: 'sha256-earlier', source: 'import', setAt: 1 };

function open(hosting: Hosting = { mode: 'url', url: URL }) {
  const project = emptyProject(['de-CH']);
  project.meta['de-CH'].name = 'Hundebewilligung';
  project.hosting = hosting;
  useStore.getState().load(project, undefined, { baseline: earlier });
  return useStore.getState().project;
}

const fetchMock = () => vi.mocked(fetch);
const bundleFile = (content: string) => new File([content], 'oca-bundle.json', { type: 'application/json' });
const errorToast = () => document.querySelector('.toast--error');

beforeEach(() => {
  useStore.getState().close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the baseline from the hosting URL', () => {
  it('fetches the bundle and makes it the baseline, leaving the project alone', async () => {
    const project = open();
    fetchMock().mockResolvedValueOnce(new Response(text, { status: 200 }));
    expect(await loadBaselineFromUrl()).toBe(true);
    expect(fetch).toHaveBeenCalledWith(URL, { cache: 'no-store' });
    expect(useStore.getState().baseline).toMatchObject({ json: text, source: 'url', integrity: await sriSha256(utf8(text)) });
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().fixNotice).toBeNull();
  });

  it('says to load a file when the host blocks the request or the network fails', async () => {
    open();
    // A cross-origin request the host does not allow rejects like a network failure.
    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await loadBaselineFromUrl()).toBe(false);
    expect(useStore.getState().fixNotice).toEqual({ kind: 'error', message: BLOCKED });
    expect(useStore.getState().baseline).toBe(earlier);
  });

  it('says the same for an answer other than 200', async () => {
    open();
    fetchMock().mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    expect(await loadBaselineFromUrl()).toBe(false);
    expect(useStore.getState().fixNotice).toEqual({ kind: 'error', message: BLOCKED });
    expect(useStore.getState().baseline).toBe(earlier);
  });

  it('turns down an answer that is not a bundle', async () => {
    open();
    fetchMock().mockResolvedValueOnce(new Response('<html>Welcome</html>', { status: 200 }));
    expect(await loadBaselineFromUrl()).toBe(false);
    expect(useStore.getState().fixNotice).toEqual({ kind: 'error', message: INVALID });
    expect(useStore.getState().baseline).toBe(earlier);
  });

  it('does nothing without a hosting URL', async () => {
    open({ mode: 'url', url: '  ' });
    expect(await loadBaselineFromUrl()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(hostingUrlOf(useStore.getState().project)).toBeNull();
    expect(hostingUrlOf({ ...emptyProject([]), hosting: { mode: 'dataUrl' } })).toBeNull();
    expect(hostingUrlOf({ ...emptyProject([]), hosting: { mode: 'url', url: ` ${URL} ` } })).toBe(URL);
  });

  it('keeps the baseline of a draft opened while the bundle loaded off the other draft', async () => {
    open();
    let answer: (response: Response) => void = () => {};
    fetchMock().mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const loading = loadBaselineFromUrl();
    useStore.getState().load(emptyProject(['de-CH']));
    answer(new Response(text, { status: 200 }));
    expect(await loading).toBe(false);
    expect(useStore.getState().baseline).toBeNull();
  });
});

describe('loading the baseline from a file', () => {
  it('reads a bundle file as the baseline without replacing the project', async () => {
    const project = open({ mode: 'dataUrl' });
    expect(await loadBaselineFromFile(bundleFile(text))).toBe(true);
    expect(useStore.getState().baseline).toMatchObject({ json: text, source: 'file', integrity: await sriSha256(utf8(bundleDataUrl(text))) });
    expect(useStore.getState().project).toBe(project);
  });

  it('turns down a file that is not a bundle', async () => {
    open();
    for (const content of ['not json', JSON.stringify({ format: 'credential-toolkit-project', version: 1 }), '']) {
      expect(await loadBaselineFromFile(bundleFile(content))).toBe(false);
      expect(useStore.getState().fixNotice).toEqual({ kind: 'error', message: INVALID });
    }
    expect(useStore.getState().baseline).toBe(earlier);
  });
});

describe('the downloaded bundle', () => {
  it('becomes the baseline as downloaded', () => {
    open();
    setDownloadedBaseline({ json: text, dataUrl: '', uri: URL, integrity: 'sha256-downloaded' });
    expect(useStore.getState().baseline).toEqual({ json: text, integrity: 'sha256-downloaded', source: 'download', setAt: expect.any(Number) });
  });
});

describe('Load published bundle', () => {
  it('offers the hosting URL only when the project has one', async () => {
    const user = userEvent.setup();
    open({ mode: 'dataUrl' });
    render(<LoadBaselineButton />);
    await user.click(screen.getByRole('button', { name: 'Load published bundle' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['From a file']);
    await user.keyboard('{Escape}');

    useStore.getState().update((project) => void (project.hosting = { mode: 'url', url: URL }));
    await user.click(screen.getByRole('button', { name: 'Load published bundle' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['From the hosting URL', 'From a file']);
  });

  it('loads from the hosting URL, and shows the error toast when the host blocks it', async () => {
    const user = userEvent.setup();
    open();
    render(
      <>
        <LoadBaselineButton />
        <FixToast />
      </>,
    );
    fetchMock().mockResolvedValueOnce(new Response(text, { status: 200 }));
    await user.click(screen.getByRole('button', { name: 'Load published bundle' }));
    await user.click(screen.getByRole('menuitem', { name: 'From the hosting URL' }));
    await waitFor(() => expect(useStore.getState().baseline?.source).toBe('url'));

    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(screen.getByRole('button', { name: 'Load published bundle' }));
    await user.click(screen.getByRole('menuitem', { name: 'From the hosting URL' }));
    await waitFor(() => expect(errorToast()).toHaveTextContent(BLOCKED));
  });

  it('loads a file chosen with the browser file picker, as the bundle import does', async () => {
    const user = userEvent.setup();
    open();
    const picked: { input?: HTMLInputElement } = {};
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      picked.input = this;
      Object.defineProperty(this, 'files', { value: [bundleFile(text)] });
      this.dispatchEvent(new Event('change'));
    });
    render(<LoadBaselineButton />);
    await user.click(screen.getByRole('button', { name: 'Load published bundle' }));
    await user.click(screen.getByRole('menuitem', { name: 'From a file' }));
    expect(picked.input?.accept).toBe('application/json,.json');
    await waitFor(() => expect(useStore.getState().baseline).toMatchObject({ json: text, source: 'file' }));
  });

  it('shows the invalid-bundle error toast for a file that is not a bundle', async () => {
    open();
    render(<FixToast />);
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [bundleFile('{"nope":true}')] });
      this.dispatchEvent(new Event('change'));
    });
    chooseBaselineFile();
    await waitFor(() => expect(errorToast()).toHaveTextContent(INVALID));
  });
});
