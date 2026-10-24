// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_KIND } from '../../core/clipboard';
import { type Node, emptyProject, newAttribute, newGroupLink, walkNodes } from '../../core/model';
import { useStore } from '../../state/store';
import { TOUR_SEEN_KEY } from '../lib/tour';
import { forgetCopiedNodes } from '../lib/treeClipboard';
import { Workspace } from './Workspace';

// The real dialog searches I14Y; this one only shows which group it would add to.
vi.mock('./I14yDialog', () => ({
  I14yDialog: ({ groupId, onClose }: { groupId: string; onClose: () => void }) => (
    <div role="dialog" aria-modal="true" aria-label="I14Y" data-group={groupId}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

/** a, person { b, c }, d, items[] { e }: in tree order a, person, b, c, d, items, e. */
function loadProject() {
  const project = emptyProject(['de-CH']);
  const person = newGroupLink('person', { source: ['person'] });
  person.group.children.push(newAttribute('b'), newAttribute('c'));
  const items = newGroupLink('items', { array: true, source: ['items', null] });
  items.group.children.push(newAttribute('e'));
  project.root.children.push(newAttribute('a'), person, newAttribute('d'), items);
  useStore.getState().load(project);
}

const project = () => useStore.getState().project!;
const nodes = () => [...walkNodes(project().root)].map(({ node }) => node);
const keys = (children: Node[] = project().root.children) => children.map((node) => node.key);
const childKeys = (key: string) => {
  const node = nodes().find((found) => found.key === key)!;
  return node.kind === 'group' ? keys(node.group.children) : [];
};
const groupId = (key: string) => {
  const node = nodes().find((found) => found.key === key)!;
  return node.kind === 'group' ? node.group.id : '';
};

const tree = () => screen.getByRole('tree', { name: 'Structure' });
/** The tree row whose key is `key` ("Credential" for the Credential row). */
const row = (key: string) => {
  const found = within(tree())
    .getAllByRole('treeitem')
    .find((item) => item.querySelector('.tree__key')?.textContent === key);
  if (!found) throw new Error(`No row "${key}"`);
  return found;
};
/** The empty area of the Structure pane, below the last row. */
const emptyArea = () => tree().parentElement!;
const selectedKeys = () =>
  within(tree())
    .getAllByRole('treeitem', { selected: true })
    .map((item) => item.querySelector('.tree__key')?.textContent);

const menu = () => screen.getByRole('menu');
const queryMenu = () => screen.queryByRole('menu');
/** The open menu's items as "label" or "label [key]", with "—" for each separator. */
const menuContents = () =>
  [...menu().querySelectorAll('[role="menuitem"], [role="separator"]')].map((element) => {
    if (element.getAttribute('role') === 'separator') return '—';
    const label = element.querySelector('.popup-menu__label')!.textContent;
    const key = element.querySelector('kbd')?.textContent;
    return key ? `${label} [${key}]` : label;
  });
const item = (name: string) => within(menu()).getByRole('menuitem', { name });

type User = ReturnType<typeof userEvent.setup>;
const rightClick = (user: User, target: Element) => user.pointer({ keys: '[MouseRight]', target });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  forgetCopiedNodes();
  loadProject();
});

describe('Structure right-click menus', () => {
  it('on an attribute: group, duplicate, add below, the moves that apply, Cut, Copy and Delete, with their shortcuts', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('a'));
    // An unselected row is selected first.
    expect(selectedKeys()).toEqual(['a']);
    expect(menu()).toHaveAccessibleName('Actions for a');
    // `a` is first: Move up does not apply and is left out rather than disabled.
    expect(menuContents()).toEqual([
      'Group selection [Ctrl+G]',
      'Duplicate [Ctrl+D]',
      'Add attribute below [N]',
      '—',
      'Move down [Alt+↓]',
      '—',
      'Cut [Ctrl+X]',
      'Copy [Ctrl+C]',
      '—',
      'Delete [Del]',
    ]);
    expect(item('Delete')).toHaveClass('popup-menu__item--danger');
    expect(item('Group selection')).toHaveFocus();

    await user.click(item('Add attribute below'));
    expect(queryMenu()).not.toBeInTheDocument();
    expect(keys()).toEqual(['a', 'attribute', 'person', 'd', 'items']);
    expect(selectedKeys()).toEqual(['attribute']);
    await waitFor(() => expect(screen.getByLabelText('Key')).toHaveFocus());
  });

  it('on a selected row acts on the whole selection, and Delete counts it', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('c'));
    await user.keyboard('{Control>}');
    await user.click(row('d'));
    await user.keyboard('{/Control}');
    expect(selectedKeys()).toEqual(['c', 'd']);

    await rightClick(user, row('d'));
    expect(selectedKeys()).toEqual(['c', 'd']);
    expect(menuContents()).toContain('Duplicate 2 items [Ctrl+D]');
    expect(menuContents()).toContain('Copy 2 items [Ctrl+C]');
    expect(menuContents()).toContain('Delete 2 items [Del]');
    await user.click(item('Delete 2 items'));
    expect(keys()).toEqual(['a', 'person', 'items']);
    expect(childKeys('person')).toEqual(['b']);
  });

  it('on an unselected row replaces the selection with that row', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    await user.keyboard('{Control>}');
    await user.click(row('d'));
    await user.keyboard('{/Control}');
    await rightClick(user, row('b'));
    expect(selectedKeys()).toEqual(['b']);
    expect(menuContents()).toContain('Delete [Del]');
  });

  it('Group selection and the moves run the shared tree actions', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('d'));
    await user.click(item('Move up'));
    expect(keys()).toEqual(['a', 'd', 'person', 'items']);
    await waitFor(() => expect(row('d')).toHaveFocus());

    await rightClick(user, row('d'));
    await user.click(item('Group selection'));
    expect(keys()).toEqual(['a', 'group', 'person', 'items']);
    expect(childKeys('group')).toEqual(['d']);
    expect(selectedKeys()).toEqual(['group']);
  });

  it('Duplicate copies the selection after the originals and selects the copies', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    await user.keyboard('{Control>}');
    await user.click(row('person'));
    await user.keyboard('{/Control}');
    await rightClick(user, row('person'));
    await user.click(item('Duplicate 2 items'));
    expect(keys()).toEqual(['a', 'a_2', 'person', 'person_2', 'd', 'items']);
    expect(childKeys('person_2')).toEqual(['b', 'c']);
    expect(selectedKeys()).toEqual(['a_2', 'person_2']);
    await waitFor(() => expect(row('person_2')).toHaveFocus());
  });

  it('on a group: adds inside it at its end, duplicates, ungroups, moves, cuts, copies and deletes it', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('person'));
    expect(menu()).toHaveAccessibleName('Actions for person');
    expect(menuContents()).toEqual([
      'Add attribute here [N]',
      'Add group here',
      'Add list of objects here',
      'Add from I14Y…',
      '—',
      'Duplicate [Ctrl+D]',
      'Ungroup [Ctrl+Shift+G]',
      'Move up [Alt+↑]',
      'Move down [Alt+↓]',
      '—',
      'Cut [Ctrl+X]',
      'Copy [Ctrl+C]',
      '—',
      'Delete group [Del]',
    ]);
    await user.click(item('Add group here'));
    expect(childKeys('person')).toEqual(['b', 'c', 'group']);

    await rightClick(user, row('person'));
    await user.click(item('Add list of objects here'));
    expect(childKeys('person')).toEqual(['b', 'c', 'group', 'items']);

    await rightClick(user, row('person'));
    await user.click(item('Add attribute here'));
    expect(childKeys('person')).toEqual(['b', 'c', 'group', 'items', 'attribute']);

    await rightClick(user, row('person'));
    await user.click(item('Ungroup'));
    expect(keys()).toEqual(['a', 'b', 'c', 'group', 'items', 'attribute', 'd', 'items']);
  });

  it('Copy, then Paste on another row, pastes copies after it and selects them', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('a'));
    // Nothing copied yet: no Paste.
    expect(menuContents()).not.toContain('Paste [Ctrl+V]');
    await user.click(item('Copy'));
    expect(keys()).toEqual(['a', 'person', 'd', 'items']);
    expect(await navigator.clipboard.readText()).toContain(`"${CLIPBOARD_KIND}"`);

    await rightClick(user, row('d'));
    expect(menuContents().slice(-6)).toEqual(['—', 'Cut [Ctrl+X]', 'Copy [Ctrl+C]', 'Paste [Ctrl+V]', '—', 'Delete [Del]']);
    await user.click(item('Paste'));
    expect(keys()).toEqual(['a', 'person', 'd', 'a_2', 'items']);
    expect(selectedKeys()).toEqual(['a_2']);
    await waitFor(() => expect(row('a_2')).toHaveFocus());

    // On a group, Paste goes inside it, at its end.
    await rightClick(user, row('person'));
    await user.click(item('Paste'));
    expect(childKeys('person')).toEqual(['b', 'c', 'a']);
  });

  it('Cut removes the selection, and Paste on the empty area puts it back at the top level', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('person'));
    await user.click(item('Cut'));
    expect(keys()).toEqual(['a', 'd', 'items']);

    await rightClick(user, emptyArea());
    expect(menuContents()).toEqual(['Add attribute here', 'Add group here', 'Add list of objects here', 'Add from I14Y…', '—', 'Paste']);
    await user.click(item('Paste'));
    expect(keys()).toEqual(['a', 'd', 'items', 'person']);
    expect(childKeys('person')).toEqual(['b', 'c']);
    expect(selectedKeys()).toEqual(['person']);
  });

  it('offers no Paste once something else is copied', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('a'));
    await user.click(item('Copy'));
    // Copying the key's text in the Edit pane.
    await user.tripleClick(screen.getByLabelText('Key'));
    await user.copy();
    await rightClick(user, row('d'));
    expect(menuContents()).not.toContain('Paste [Ctrl+V]');
  });

  it('on a group, Add from I14Y… opens the I14Y dialog for that group', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('person'));
    await user.click(item('Add from I14Y…'));
    expect(screen.getByRole('dialog', { name: 'I14Y' })).toHaveAttribute('data-group', groupId('person'));
  });

  it('on a list of objects: Duplicate but no Ungroup; Delete group deletes it', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('items'));
    expect(menuContents()).toEqual([
      'Add attribute here [N]',
      'Add group here',
      'Add list of objects here',
      'Add from I14Y…',
      '—',
      'Duplicate [Ctrl+D]',
      'Move up [Alt+↑]',
      '—',
      'Cut [Ctrl+X]',
      'Copy [Ctrl+C]',
      '—',
      'Delete group [Del]',
    ]);
    await user.click(item('Delete group'));
    expect(keys()).toEqual(['a', 'person', 'd']);
  });

  it('a multi-selection with a group shows no Ungroup and counts Delete', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('a'));
    await user.keyboard('{Control>}');
    await user.click(row('person'));
    await user.keyboard('{/Control}');
    await rightClick(user, row('person'));
    expect(menuContents()).not.toContain('Ungroup [Ctrl+Shift+G]');
    expect(menuContents().at(-1)).toBe('Delete 2 items [Del]');
  });

  it('on the empty area: the Add items at the top level, whatever is selected', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('b'));
    await rightClick(user, emptyArea());
    expect(menu()).toHaveAccessibleName('Structure actions');
    expect(menuContents()).toEqual(['Add attribute here', 'Add group here', 'Add list of objects here', 'Add from I14Y…']);
    // The selection stays as it was.
    expect(selectedKeys()).toEqual(['b']);
    await user.click(item('Add attribute here'));
    expect(keys()).toEqual(['a', 'person', 'd', 'items', 'attribute']);

    await rightClick(user, emptyArea());
    await user.click(item('Add from I14Y…'));
    expect(screen.getByRole('dialog', { name: 'I14Y' })).toHaveAttribute('data-group', project().root.id);
  });

  it('on the empty area of an empty structure too', async () => {
    useStore.getState().load(emptyProject(['de-CH']));
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, screen.getByText('No attributes yet.'));
    await user.click(item('Add group here'));
    expect(keys()).toEqual(['group']);
  });

  it('closes on Escape and on a click elsewhere without doing anything', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await rightClick(user, row('a'));
    await user.keyboard('{Escape}');
    expect(queryMenu()).not.toBeInTheDocument();
    expect(row('a')).toHaveFocus();

    await rightClick(user, row('d'));
    await user.click(row('Credential'));
    expect(queryMenu()).not.toBeInTheDocument();
    expect(keys()).toEqual(['a', 'person', 'd', 'items']);
  });

  it('opens with Shift+F10 and the context-menu key on the focused row; arrows, Enter and Escape work', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(row('d'));
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(menu()).toHaveAccessibleName('Actions for d');
    expect(item('Group selection')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Duplicate')).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Group selection')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(queryMenu()).not.toBeInTheDocument();
    expect(row('d')).toHaveFocus();

    // The context-menu key, then ↓ ↓ ↓ to Move up and ⏎.
    await user.keyboard('{ContextMenu}');
    expect(item('Group selection')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(queryMenu()).not.toBeInTheDocument();
    expect(keys()).toEqual(['a', 'd', 'person', 'items']);
    await waitFor(() => expect(row('d')).toHaveFocus());
  });

  it('opens the top-level menu from the Credential row', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    act(() => row('Credential').focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(menu()).toHaveAccessibleName('Structure actions');
    expect(selectedKeys()).toEqual(['Credential']);
  });

  it('does not open while the tour or a dialog is open', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    act(() => useStore.getState().setTourOpen(true));
    fireEvent.contextMenu(row('a'));
    expect(queryMenu()).not.toBeInTheDocument();
    act(() => useStore.getState().setTourOpen(false));

    act(() => useStore.getState().setLanguagesOpen(true));
    fireEvent.contextMenu(row('a'));
    fireEvent.keyDown(row('a'), { key: 'ContextMenu' });
    expect(queryMenu()).not.toBeInTheDocument();
    act(() => useStore.getState().setLanguagesOpen(false));
    await rightClick(user, row('a'));
    expect(menu()).toBeInTheDocument();
  });

  it('does not open under 1000 px, leaving the browser’s own menu', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<Workspace />);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => void row('a').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    act(() => row('a').focus());
    fireEvent.keyDown(row('a'), { key: 'F10', shiftKey: true });
    expect(queryMenu()).not.toBeInTheDocument();
  });
});
