import { isPlainObject } from './import/report.ts';
import {
  type AttrType,
  type ClaimsPath,
  type Entries,
  type Group,
  type I14yLink,
  type LangTag,
  type Node,
  type Project,
  PRIMITIVE_TYPES,
  type PrimitiveType,
  emptyGroup,
  findGroup,
  findNode,
  walkNodes,
} from './model.ts';
import { cloneNode, outermostIds, uniqueKey } from './operations.ts';
import { listExpressions, resolveEditorPath, retargetTemplate } from './templates.ts';

/*
 * Nodes on the system clipboard, as JSON text:
 *
 *   { "kind": "credential-toolkit/nodes", "version": 1, "items": [{ "parent": 0, "node": { …a Node… } }, …] }
 *
 * `items` are the copied nodes in tree order, each with its whole subtree. Items with the same `parent`
 * number were siblings in the project they came from, so references between them can follow on paste.
 */

export const CLIPBOARD_KIND = 'credential-toolkit/nodes';
export const CLIPBOARD_VERSION = 1;

export interface ClipboardItem {
  /** Items with the same number sat in the same group. */
  parent: number;
  node: Node;
}

export interface ClipboardNodes {
  items: ClipboardItem[];
}

/**
 * The clipboard text for the given nodes and their subtrees; a node inside another given node travels
 * with that ancestor. Undefined when no given id names a node.
 */
export function serializeNodes(project: Project, nodeIds: Iterable<string>): string | undefined {
  const parents: Group[] = [];
  const items = outermostIds(project, nodeIds).map((id): ClipboardItem => {
    const { node, parent } = findNode(project.root, id)!;
    const index = parents.indexOf(parent);
    return { parent: index >= 0 ? index : parents.push(parent) - 1, node };
  });
  if (!items.length) return undefined;
  return JSON.stringify({ kind: CLIPBOARD_KIND, version: CLIPBOARD_VERSION, items });
}

/**
 * The nodes in clipboard `text`, rebuilt field by field from what `serializeNodes` writes. Null for any
 * other text, and for nodes that are not well formed, so a paste never puts a broken node in the tree.
 */
export function parseClipboard(text: string): ClipboardNodes | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isPlainObject(value) || value.kind !== CLIPBOARD_KIND || value.version !== CLIPBOARD_VERSION) return null;
    if (!Array.isArray(value.items) || value.items.length === 0) return null;
    const items: ClipboardItem[] = [];
    for (const item of value.items) {
      if (!isPlainObject(item) || !Number.isInteger(item.parent) || (item.parent as number) < 0) return null;
      const node = parseNode(item.node);
      if (!node) return null;
      items.push({ parent: item.parent as number, node });
    }
    return { items };
  } catch {
    // Not JSON, or nested too deep to walk.
    return null;
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isPlainObject(value) || !Object.values(value).every(isString)) return null;
  return { ...(value as Record<string, string>) };
}

function nestedStringRecord(value: unknown): Record<string, Record<string, string>> | null {
  if (!isPlainObject(value)) return null;
  const result: Record<string, Record<string, string>> = {};
  for (const [key, inner] of Object.entries(value)) {
    const record = stringRecord(inner);
    if (!record) return null;
    result[key] = record;
  }
  return result;
}

function parsePath(value: unknown): ClaimsPath | null {
  if (!Array.isArray(value)) return null;
  const valid = value.every((segment) => segment === null || isString(segment) || (Number.isInteger(segment) && segment >= 0));
  return valid ? [...(value as ClaimsPath)] : null;
}

const isPrimitive = (value: unknown): value is PrimitiveType => (PRIMITIVE_TYPES as readonly unknown[]).includes(value);

function parseType(value: unknown): AttrType | null {
  if (isPrimitive(value)) return value;
  return isPlainObject(value) && isPrimitive(value.array) ? { array: value.array } : null;
}

function parseEntries(value: unknown): Entries | null {
  if (!isPlainObject(value) || !Array.isArray(value.codes) || !value.codes.every(isString)) return null;
  const labels = nestedStringRecord(value.labels);
  return labels ? { codes: [...value.codes], labels } : null;
}

function parseI14y(value: unknown): I14yLink | null {
  if (!isPlainObject(value)) return null;
  const { conceptId, identifier, registrationStatus } = value;
  if (!isString(conceptId) || !isString(identifier) || !isString(registrationStatus)) return null;
  const name = stringRecord(value.name);
  const publisher = stringRecord(value.publisher);
  const values = nestedStringRecord(value.values);
  return name && publisher && values ? { conceptId, identifier, registrationStatus, name, publisher, values } : null;
}

function parseNode(value: unknown): Node | null {
  if (!isPlainObject(value) || !isString(value.id) || !isString(value.key) || typeof value.sensitive !== 'boolean') return null;
  const labels = stringRecord(value.labels);
  if (!labels) return null;
  const { id, key, sensitive } = value;
  if (value.kind === 'attribute') {
    const type = parseType(value.type);
    const source = parsePath(value.source);
    if (!type || !source || (value.standard !== undefined && !isString(value.standard))) return null;
    const entries = value.entries === undefined ? undefined : parseEntries(value.entries);
    const i14y = value.i14y === undefined ? undefined : parseI14y(value.i14y);
    if (entries === null || i14y === null) return null;
    return {
      kind: 'attribute',
      id,
      key,
      type,
      source,
      sensitive,
      labels,
      ...(value.standard !== undefined && { standard: value.standard as string }),
      ...(entries && { entries }),
      ...(i14y && { i14y }),
    };
  }
  if (value.kind === 'group') {
    const source = value.source === undefined ? undefined : parsePath(value.source);
    const group = value.group;
    if (source === null || typeof value.array !== 'boolean' || !isPlainObject(group) || !isString(group.id)) return null;
    if (!Array.isArray(group.children) || !Array.isArray(group.passthrough) || !group.passthrough.every(isPlainObject)) return null;
    const children: Node[] = [];
    for (const child of group.children) {
      const node = parseNode(child);
      if (!node) return null;
      children.push(node);
    }
    return {
      kind: 'group',
      id,
      key,
      array: value.array,
      ...(source && { source }),
      sensitive,
      labels,
      group: { id: group.id, children, passthrough: structuredClone(group.passthrough) },
    };
  }
  return null;
}

/** Drops the labels (and value-list labels) of `node` and its subtree in languages outside `languages`. */
function keepLanguages(node: Node, languages: ReadonlySet<LangTag>): void {
  const nodes = [node, ...(node.kind === 'group' ? [...walkNodes(node.group)].map(({ node: inner }) => inner) : [])];
  for (const each of nodes) {
    for (const lang of Object.keys(each.labels)) if (!languages.has(lang)) delete each.labels[lang];
    if (each.kind === 'attribute' && each.entries) {
      for (const lang of Object.keys(each.entries.labels)) if (!languages.has(lang)) delete each.entries.labels[lang];
    }
  }
}

/** Every node of `node`'s subtree, `node` first, each with the group it sits in (`parent` for `node`). */
function subtree(node: Node, parent: Group): { node: Node; parent: Group }[] {
  return [{ node, parent }, ...(node.kind === 'group' ? walkNodes(node.group) : [])];
}

/**
 * Inserts copies of the clipboard nodes into the group `groupId`, before its child at `index` (at the
 * end when omitted), in clipboard order. Copies get fresh ids (`cloneNode`) and keys unique among their
 * new siblings (`uniqueKey`). Labels in languages the project does not have are dropped; its languages
 * that have no text stay empty. `{{…}}` references are kept as written, except that a relative one that
 * pointed inside the copied nodes points to the matching copy. Returns the ids of the copies, in order;
 * empty (and nothing changes) when the group does not exist.
 */
export function pasteNodes(project: Project, nodes: ClipboardNodes, groupId: string, index?: number): string[] {
  const group = findGroup(project.root, groupId);
  if (!group) return [];
  const languages = new Set(project.languages);
  // The copied nodes as they were, under their old keys, so references resolve as when they were written.
  const sources = new Map<number, Group>();
  for (const { parent, node } of nodes.items) {
    const source = sources.get(parent) ?? emptyGroup();
    source.children.push(node);
    sources.set(parent, source);
  }
  let at = Math.max(0, Math.min(index ?? group.children.length, group.children.length));
  const copied = new Map<string, string>();
  const pasted = nodes.items.map(({ parent, node }) => {
    const { copy, ids } = cloneNode(node);
    copy.key = uniqueKey(group, node.key);
    keepLanguages(copy, languages);
    group.children.splice(at++, 0, copy);
    for (const [from, to] of ids) copied.set(from, to);
    return { original: node, source: sources.get(parent)!, copy };
  });

  const byId = new Map<string, Node>();
  const parents = new Map<string, Group>();
  for (const { node, parent } of walkNodes(project.root)) {
    byId.set(node.id, node);
    parents.set(node.id, parent);
  }
  for (const { original, source, copy } of pasted) {
    const originals = subtree(original, source);
    subtree(copy, group).forEach(({ node, parent }, position) => {
      const owner = originals[position].parent;
      for (const [lang, text] of Object.entries(node.labels)) {
        if (!text) continue;
        const targets = listExpressions(text).map((expression) => {
          const target = expression.absolute ? null : resolveEditorPath(owner, owner, expression)?.node;
          const id = target && copied.get(target.id);
          return (id && byId.get(id)) || null;
        });
        if (targets.some(Boolean)) node.labels[lang] = retargetTemplate(text, project.root, parent, targets, (target) => parents.get(target.id));
      }
    });
  }
  return pasted.map(({ copy }) => copy.id);
}
