// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_KIND } from '../../core/clipboard';
import { type Node, emptyProject, newAttribute, newGroupLink, walkNodes } from '../../core/model';
import { useStore } from '../../state/store';
import { TOUR_SEEN_KEY } from '../lib/tour';
import { forgetCopiedNodes } from '../lib/treeClipboard';
import { Workspace } from './Workspace';

vi.mock('./I14yDialog', () => ({ I14yDialog: () => null }));

/** a, person { b, c }, d: labels in German and English on a. */
function loadProject() {
  const project = emptyProject(['de-CH', 'en-GB']);
  const person = newGroupLink('person', { source: ['person'] });
  person.group.children.push(newAttribute('b'), newAttribute('c'));
  project.root.children.push(newAttribute('a', { labels: { 'de-CH': 'A de', 'en-GB': 'A en' } }), person, newAttribute('d'));
  useStore.getState().load(project);
}

const project = () => useStore.getState().project!;
const nodes = () => [...walkNodes(project().root)].map(({ node }) => node);
const keys = (children: Node[] = project().root.children) => children.map((node) => node.key);
const childKeys = (key: string) => {
  const node = nodes().find((found) => found.key === key)!;
  return node.kind === 'group' ? keys(node.group.children) : [];
};

const tree = () => screen.getByRole('tree', { name: 'Structure' });
const row = (key: string) => {
  const found = within(tree())
    .getAllByRole('treeitem')
    .find((item) => item.querySelector('.tree__key')?.textContent === key);
  if (!found) throw new Error(`No row "${key}"`);
  return found;
};
const selectedKeys = () =>
  within(tree())
    .getAllByRole('treeitem', { selected: true })
    .map((item) => item.querySelector('.tree__key')?.textContent);

/** A stand-in for the event's DataTransfer, holding plain text only. */
function clipboard(text = '') {
  const data = { text };
  return {
    data,
    getData: (type: string) => (type === 'text/plain' ? data.text : ''),
    setData: (type: string, value: string) => {
      if (type === 'text/plain') data.text = value;
    },
  };
}

/** Fires ⌘C / ⌘X's event on the focused element; returns the clipboard text and whether the page handled it. */
function copyOrCut(type: 'copy' | 'cut') {
  const clipboardData = clipboard();
  const target = document.activeElement!;
  const event = createEvent[type](target, { clipboardData });
  act(() => void fireEvent(target, event));
  return { text: clipboardData.data.text, handled: event.defaultPrevented };
}

/** Fires ⌘V's event, with `text` on the clipboard, on the focused element; returns whether the page handled it. */
function paste(text: string) {
  const target = document.activeElement!;
  const event = createEvent.paste(target, { clipboardData: clipboard(text) });
  act(() => void fireEvent(target, event));
  return event.defaultPrevented;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  forgetCopiedNodes();
  loadProject();
});

describe('Structure copy, cut and paste', () => {
  it('⌘C then ⌘V pastes copies after the selected attribute, with new ids and unique keys, and selects them', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    const { text, handled } = copyOrCut('copy');
    expect(handled).toBe(true);
    expect(JSON.parse(text).kind).toBe(CLIPBOARD_KIND);
    expect(keys()).toEqual(['a', 'person', 'd']);

    await user.click(row('d'));
    expect(paste(text)).toBe(true);
    expect(keys()).toEqual(['a', 'person', 'd', 'a_2']);
    const [original, copy] = [project().root.children[0], project().root.children[3]];
    expect(copy.id).not.toBe(original.id);
    expect(copy.labels).toEqual(original.labels);
    expect(selectedKeys()).toEqual(['a_2']);
    await waitFor(() => expect(row('a_2')).toHaveFocus());
  });

  it('pastes inside a selected group at its end, and at the top level from the Credential row', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('d'));
    const { text } = copyOrCut('copy');
    await user.click(row('person'));
    paste(text);
    expect(childKeys('person')).toEqual(['b', 'c', 'd']);
    await user.click(row('Credential'));
    paste(text);
    expect(keys()).toEqual(['a', 'person', 'd', 'd_2']);
  });

  it('copies a multi-selection, outermost nodes with their subtrees, and selects all the copies', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    await user.keyboard('{Control>}');
    await user.click(row('b'));
    await user.click(row('person'));
    await user.keyboard('{/Control}');
    const { text } = copyOrCut('copy');
    await user.click(row('Credential'));
    paste(text);
    expect(keys()).toEqual(['a', 'person', 'd', 'a_2', 'person_2']);
    expect(childKeys('person_2')).toEqual(['b', 'c']);
    expect(selectedKeys()).toEqual(['a_2', 'person_2']);
  });

  it('⌘X then ⌘V moves the nodes; cut and paste are one undo step each', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('c'));
    const { text, handled } = copyOrCut('cut');
    expect(handled).toBe(true);
    expect(childKeys('person')).toEqual(['b']);
    // The row after the cut one is selected and keeps focus.
    expect(selectedKeys()).toEqual(['d']);
    await waitFor(() => expect(row('d')).toHaveFocus());

    paste(text);
    expect(keys()).toEqual(['a', 'person', 'd', 'c']);
    expect(nodes().filter((node) => node.key === 'c')).toHaveLength(1);

    act(() => useStore.getState().undo());
    expect(keys()).toEqual(['a', 'person', 'd']);
    expect(childKeys('person')).toEqual(['b']);
    act(() => useStore.getState().undo());
    expect(childKeys('person')).toEqual(['b', 'c']);
  });

  it('pastes into another project, dropping labels in languages it does not have', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Workspace />);
    await user.click(row('a'));
    const { text } = copyOrCut('copy');
    unmount();
    act(() => useStore.getState().close());

    act(() => useStore.getState().load(emptyProject(['en-GB', 'fr-CH'])));
    render(<Workspace />);
    await user.click(row('Credential'));
    expect(paste(text)).toBe(true);
    expect(keys()).toEqual(['a']);
    expect(project().root.children[0].labels).toEqual({ 'en-GB': 'A en' });
  });

  it('ignores text that is not nodes from this app', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    const before = project();
    expect(paste('hello')).toBe(false);
    expect(paste(JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, items: [{ parent: 0, node: {} }] }))).toBe(false);
    expect(project()).toBe(before);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('keeps a tree filter that shows the pasted nodes, and selects them', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    act(() => useStore.getState().setTreeFilter('a'));
    await user.click(row('a'));
    const { text } = copyOrCut('copy');
    paste(text);
    expect(keys()).toEqual(['a', 'a_2', 'person', 'd']);
    expect(useStore.getState().treeFilter).toBe('a');
    expect(within(tree()).queryByText('d')).toBeNull();
    expect(selectedKeys()).toEqual(['a_2']);
    await waitFor(() => expect(row('a_2')).toHaveFocus());
  });

  it('clears a tree filter that would hide the pasted nodes', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('d'));
    const { text } = copyOrCut('copy');
    act(() => useStore.getState().setTreeFilter('a'));
    await user.click(row('a'));
    paste(text);
    expect(keys()).toEqual(['a', 'd_2', 'person', 'd']);
    expect(useStore.getState().treeFilter).toBe('');
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Filter the structure' }).value).toBe('');
    expect(selectedKeys()).toEqual(['d_2']);
    await waitFor(() => expect(row('d_2')).toHaveFocus());
  });

  it('does nothing while typing in a field, or with nothing but the Credential selected', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    const { text } = copyOrCut('copy');

    await user.click(screen.getByLabelText('Key'));
    expect(copyOrCut('copy')).toEqual({ text: '', handled: false });
    expect(copyOrCut('cut')).toEqual({ text: '', handled: false });
    expect(paste(text)).toBe(false);
    expect(keys()).toEqual(['a', 'person', 'd']);

    await user.click(row('Credential'));
    expect(copyOrCut('copy')).toEqual({ text: '', handled: false });
  });

  it('does nothing while the tour is open', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    const { text } = copyOrCut('copy');
    act(() => useStore.getState().setTourOpen(true));
    act(() => row('a').focus());
    expect(copyOrCut('cut').handled).toBe(false);
    expect(paste(text)).toBe(false);
    expect(keys()).toEqual(['a', 'person', 'd']);
  });
});
