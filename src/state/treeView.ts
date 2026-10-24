import { type Group, type LangTag, type Node, type Project, findNode, walkNodes } from '../core/model';
import type { Selection, SelectionRequest } from './selection';

/*
 * What the Structure tree shows: groups (also lists of objects) can be collapsed, which hides
 * everything inside them. Collapsed groups are listed by the id of their node (their row id).
 */

/**
 * The node rows the tree shows, in order: every node, depth-first, without the ones inside a
 * collapsed group. ↑ / ↓, Home / End and ⇧ ranges move over these rows only. While the tree is
 * filtered, the rows are the `shown` ones (`filteredIds`), whether or not a group around them is collapsed.
 */
export function visibleRows(project: Project, collapsed: readonly string[], shown: ReadonlySet<string> | null = null): string[] {
  if (shown) return [...walkNodes(project.root)].flatMap(({ node }) => (shown.has(node.id) ? [node.id] : []));
  const shut = new Set(collapsed);
  const rows: string[] = [];
  const visit = (group: Group) => {
    for (const node of group.children) {
      rows.push(node.id);
      if (node.kind === 'group' && !shut.has(node.id)) visit(node.group);
    }
  };
  visit(project.root);
  return rows;
}

/** Whether `node`'s key or its label in `lang` holds `text` (lower case), ignoring case. */
function matchesFilter(node: Node, text: string, lang: LangTag): boolean {
  return node.key.toLowerCase().includes(text) || (node.labels[lang] ?? '').toLowerCase().includes(text);
}

/**
 * The node rows the tree's filter box shows for `text`: the nodes whose key or label in the editing
 * language `lang` holds it, ignoring case, with the groups around them (expanded for the filtered view,
 * collapsed or not). Null when `text` is blank: the tree is not filtered. Empty when nothing matches.
 */
export function filteredIds(project: Project, text: string, lang: LangTag): Set<string> | null {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return null;
  const shown = new Set<string>();
  // Returns whether anything in `group` is shown, so the group node around it is shown too.
  const visit = (group: Group): boolean => {
    let any = false;
    for (const node of group.children) {
      const inside = node.kind === 'group' && visit(node.group);
      if (inside || matchesFilter(node, wanted, lang)) {
        shown.add(node.id);
        any = true;
      }
    }
    return any;
  };
  visit(project.root);
  return shown;
}

/** The ids of the group nodes that hold node `id`, outermost first (none at the top level or for an unknown id). */
export function ancestorIds(project: Project, id: string): string[] {
  const path: string[] = [];
  const search = (group: Group): boolean => {
    for (const node of group.children) {
      if (node.id === id) return true;
      if (node.kind !== 'group') continue;
      path.push(node.id);
      if (search(node.group)) return true;
      path.pop();
    }
    return false;
  };
  return search(project.root) ? path : [];
}

/** The node ids inside group node `groupId`, at any depth (none when it is not a group). */
function idsInside(project: Project, groupId: string): Set<string> {
  const node = findNode(project.root, groupId)?.node;
  return new Set(node?.kind === 'group' ? [...walkNodes(node.group)].map(({ node: inner }) => inner.id) : []);
}

/**
 * `collapsed` without the groups that hide a selected node, so the selection always shows. Returns
 * `collapsed` itself when no selected node is hidden.
 */
export function revealSelection(project: Project, selection: Selection, collapsed: string[]): string[] {
  if (selection.kind !== 'node' || collapsed.length === 0) return collapsed;
  const open = new Set(selection.ids.flatMap((id) => ancestorIds(project, id)));
  const next = collapsed.filter((id) => !open.has(id));
  return next.length === collapsed.length ? collapsed : next;
}

/**
 * The selection once group node `groupId` collapses, or null when no selected node goes out of sight.
 * The selected nodes inside it give way to the group itself, which also takes over as the primary or
 * the anchor when either was inside.
 */
export function selectionOnCollapse(project: Project, selection: Selection, groupId: string): SelectionRequest | null {
  if (selection.kind !== 'node') return null;
  const inside = idsInside(project, groupId);
  if (!selection.ids.some((id) => inside.has(id))) return null;
  const ids = [...selection.ids.filter((id) => !inside.has(id)), groupId];
  const id = inside.has(selection.id) ? groupId : selection.id;
  return { kind: 'node', id, ids, anchor: inside.has(selection.anchor) ? groupId : selection.anchor };
}

export const COLLAPSED_KEY = 'credential-toolkit:collapsed-groups';
/** How many projects' collapsed groups are remembered; the ones left untouched longest go first. */
const REMEMBERED_PROJECTS = 20;

/*
 * Collapsed groups are remembered per project, keyed by the id of its top-level group: it lasts as
 * long as the project (the draft keeps it across reloads), and an opened bundle gets a new one.
 */

/** Every remembered project's collapsed groups, or none when there are none, they are not JSON or storage is unavailable. */
function loadAll(): Record<string, string[]> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null');
    return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** The collapsed groups remembered for `project`, among the groups it still has. */
export function loadCollapsed(project: Project): string[] {
  const stored: unknown = loadAll()[project.root.id];
  if (!Array.isArray(stored)) return [];
  const groups = new Set([...walkNodes(project.root)].flatMap(({ node }) => (node.kind === 'group' ? [node.id] : [])));
  return stored.filter((id): id is string => typeof id === 'string' && groups.has(id));
}

export function saveCollapsed(project: Project, collapsed: string[]): void {
  const all = loadAll();
  // Re-adding the project moves it to the end, the most recently touched.
  delete all[project.root.id];
  if (collapsed.length) all[project.root.id] = collapsed;
  const kept = Object.entries(all).slice(-REMEMBERED_PROJECTS);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage may be unavailable or full; the groups then stay collapsed until the page is closed.
  }
}
