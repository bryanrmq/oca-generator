/**
 * Drafts kept in this browser. Every project open in the workspace is a draft (`AppState.draftId`): the store's
 * `load` makes a new one unless it is given a stored draft's id, and autosave (`startAutosave`) keeps it stored.
 * Drafts live in IndexedDB; without it (private mode, blocked storage) they live in memory for the session and
 * the workspace says that nothing is saved.
 *
 * The API for the UI:
 * - `useDrafts`: the drafts list (`drafts`, newest first), whether storage works (`available`), and the draft
 *   last open (`rememberedId`), which a reload offers to continue (`selectResumeDraft`).
 * - `draftDisplayName(summary)`: the name to show.
 * - `openDraft(id)`, `createDraft(project)`: open a stored draft or a new one in the workspace.
 * - `getDraft(id)`: a whole draft, project included.
 * - `renameDraft(id, name)`, `deleteDraft(id)` (returns the draft so that `restoreDraft` can undo it).
 * - `saveOpenDraft()`: saves the open draft now instead of after the autosave delay.
 *
 * A draft's published baseline (`AppState.baseline`) is stored with it and saved as soon as it changes.
 */
import { create } from 'zustand';
import { type Baseline, isBaseline } from '../core/baseline';
import type { ReportNote } from '../core/import/report';
import { type LangTag, type Project, newId } from '../core/model';
import { isProject } from '../core/projectFile';
import { t } from '../strings';
import { DRAFTS_STORE, SUMMARIES_STORE, openDatabase, transact } from './idb';
import { useStore } from './store';

/** Where the single draft lived before drafts moved to IndexedDB. Read once to migrate it, then removed. */
export const DRAFT_KEY = 'credential-toolkit:draft';
/** The id of the draft last open in the workspace. */
export const OPEN_DRAFT_KEY = 'credential-toolkit:open-draft';
const AUTOSAVE_DELAY_MS = 500;

/** One stored draft. */
export interface DraftRecord {
  id: string;
  /** The name the user gave the draft; without one it is named after the credential. */
  customName?: string;
  /** When the draft was last saved, in milliseconds since the epoch. */
  updatedAt: number;
  project: Project;
  /** The bundle the draft was last published as (`core/baseline.ts`), when known. */
  baseline?: Baseline;
}

/** What the drafts list needs to know about a draft, without its project. */
export interface DraftSummary {
  id: string;
  customName?: string;
  updatedAt: number;
  /** The credential name in the project's first language, trimmed; empty when there is none. */
  credentialName: string;
  languages: LangTag[];
}

export interface DraftsState {
  /** Whether drafts outlive the page. Until `initDrafts` has run (in tests that never call it), drafts live in memory. */
  available: boolean;
  /** Every draft, the most recently saved first. */
  drafts: DraftSummary[];
  /** The draft last open in the workspace, if it still exists. */
  rememberedId: string | null;
}

export const useDrafts = create<DraftsState>(() => ({ available: true, drafts: [], rememberedId: null }));

/** The draft the start screen offers to continue: the one last open, else the newest. */
export function selectResumeDraft(state: DraftsState): DraftSummary | null {
  return state.drafts.find((draft) => draft.id === state.rememberedId) ?? state.drafts[0] ?? null;
}

/** The draft's custom name, else the credential name, else "Untitled credential". */
export function draftDisplayName(draft: Pick<DraftSummary, 'customName' | 'credentialName'>): string {
  return draft.customName || draft.credentialName || t.drafts.untitled;
}

function summaryOf({ id, customName, updatedAt, project }: DraftRecord): DraftSummary {
  const credentialName = project.meta[project.languages[0]]?.name?.trim() ?? '';
  return { id, ...(customName && { customName }), updatedAt, credentialName, languages: [...project.languages] };
}

const newestFirst = (a: DraftSummary, b: DraftSummary) => b.updatedAt - a.updatedAt;

/** Where drafts are kept: IndexedDB, or memory when the browser has no usable storage. */
interface Backend {
  summaries(): Promise<DraftSummary[]>;
  get(id: string): Promise<DraftRecord | undefined>;
  put(record: DraftRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

function databaseBackend(db: IDBDatabase): Backend {
  const both = [DRAFTS_STORE, SUMMARIES_STORE];
  return {
    summaries: () => transact(db, [SUMMARIES_STORE], 'readonly', (tx) => tx.objectStore(SUMMARIES_STORE).getAll() as IDBRequest<DraftSummary[]>),
    get: (id) => transact(db, [DRAFTS_STORE], 'readonly', (tx) => tx.objectStore(DRAFTS_STORE).get(id) as IDBRequest<DraftRecord | undefined>),
    put: (record) =>
      transact(db, both, 'readwrite', (tx) => {
        tx.objectStore(DRAFTS_STORE).put(record);
        tx.objectStore(SUMMARIES_STORE).put(summaryOf(record));
      }),
    remove: (id) =>
      transact(db, both, 'readwrite', (tx) => {
        tx.objectStore(DRAFTS_STORE).delete(id);
        tx.objectStore(SUMMARIES_STORE).delete(id);
      }),
  };
}

function memoryBackend(): Backend {
  const records = new Map<string, DraftRecord>();
  return {
    summaries: async () => [...records.values()].map(summaryOf),
    get: async (id) => records.get(id),
    put: async (record) => void records.set(record.id, record),
    remove: async (id) => void records.delete(id),
  };
}

let backend: Backend = memoryBackend();
let database: IDBDatabase | null = null;
/** The draft the crash screen downloads: the open one, else the one last open. */
let latest: { id: string; project: Project } | null = null;
/** The open draft's save that waits for edits to settle. */
let pending: { id: string; project: Project; baseline: Baseline | null; timer: ReturnType<typeof setTimeout> } | null = null;

function cancelPending() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

function readLegacyDraft(): Project | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isProject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function remember(id: string | null) {
  useDrafts.setState({ rememberedId: id });
  try {
    if (id) localStorage.setItem(OPEN_DRAFT_KEY, id);
    else localStorage.removeItem(OPEN_DRAFT_KEY);
  } catch {
    // Without storage a reload offers the newest draft instead.
  }
}

function rememberedFromStorage(): string | null {
  try {
    return localStorage.getItem(OPEN_DRAFT_KEY);
  } catch {
    return null;
  }
}

function upsertSummary(summary: DraftSummary) {
  const others = useDrafts.getState().drafts.filter((draft) => draft.id !== summary.id);
  useDrafts.setState({ drafts: [...others, summary].sort(newestFirst) });
}

/**
 * Opens the drafts database and reads the drafts list. Runs once before the app renders (and again in tests,
 * which start over each time); never rejects. Moves the single draft of earlier versions into the database,
 * removing the old copy only once the new one is written, and makes it the draft to continue.
 */
export async function initDrafts(): Promise<void> {
  cancelPending();
  database?.close();
  database = null;
  latest = null;
  let next: Backend;
  let available = true;
  try {
    database = await openDatabase();
    next = databaseBackend(database);
  } catch {
    next = memoryBackend();
    available = false;
  }

  const legacy = readLegacyDraft();
  let migratedId: string | null = null;
  if (legacy) {
    const record: DraftRecord = { id: newId(), updatedAt: Date.now(), project: legacy };
    try {
      await next.put(record);
      if (available) localStorage.removeItem(DRAFT_KEY);
    } catch {
      // The old key stays for the next load to try again; meanwhile the draft lives in memory.
      next = memoryBackend();
      available = false;
      await next.put(record);
    }
    migratedId = record.id;
  }

  backend = next;
  let drafts: DraftSummary[] = [];
  try {
    drafts = (await backend.summaries()).sort(newestFirst);
  } catch {
    // An unreadable list starts empty; saving still works.
  }
  const wanted = migratedId ?? rememberedFromStorage();
  useDrafts.setState({ available, drafts, rememberedId: drafts.some((draft) => draft.id === wanted) ? wanted : null });
  if (migratedId) remember(migratedId);
  const resume = selectResumeDraft(useDrafts.getState());
  const record = resume && (await getDraft(resume.id));
  if (record) latest = { id: record.id, project: record.project };
}

/** The stored draft `id` with its project, or null when there is none or it cannot be read. */
export async function getDraft(id: string): Promise<DraftRecord | null> {
  try {
    const record = await backend.get(id);
    return record && isProject(record.project) ? record : null;
  } catch {
    return null;
  }
}

/** Opens the stored draft `id` in the workspace. Resolves false when it cannot be read. */
export async function openDraft(id: string): Promise<boolean> {
  const record = await getDraft(id);
  if (!record) return false;
  const baseline = isBaseline(record.baseline) ? record.baseline : undefined;
  useStore.getState().load(record.project, undefined, { draftId: id, baseline });
  return true;
}

/** Opens `project` in the workspace as a new draft, with `options.baseline`, stored right away, and returns its id. */
export function createDraft(project: Project, report?: ReportNote[], options?: { reviewI14y?: boolean; baseline?: Baseline }): string {
  useStore.getState().load(project, report, options);
  return useStore.getState().draftId!;
}

/**
 * Writes the draft and reports in the store whether it worked, which shows or clears the out-of-space banner.
 * A failed write changes nothing that was stored.
 */
async function writeDraft(id: string, project: Project, baseline: Baseline | null): Promise<boolean> {
  latest = { id, project };
  const customName = useDrafts.getState().drafts.find((draft) => draft.id === id)?.customName;
  const record: DraftRecord = { id, ...(customName && { customName }), updatedAt: Date.now(), project, ...(baseline && { baseline }) };
  let ok = true;
  try {
    await backend.put(record);
    upsertSummary(summaryOf(record));
  } catch {
    ok = false;
  }
  useStore.getState().setDraftSaveFailed(!ok);
  return ok;
}

function flush(): Promise<boolean> {
  if (!pending) return Promise.resolve(true);
  const { id, project, baseline } = pending;
  cancelPending();
  return writeDraft(id, project, baseline);
}

/** Saves the open draft now: its waiting autosave, or else the project as it is. */
export function saveOpenDraft(): Promise<boolean> {
  if (pending) return flush();
  const { draftId, project, baseline } = useStore.getState();
  return draftId && project ? writeDraft(draftId, project, baseline) : Promise.resolve(true);
}

/** Gives draft `id` a custom name, or names it after the credential again when `name` is blank. Keeps its place in the list. */
export async function renameDraft(id: string, name: string): Promise<boolean> {
  const record = await getDraft(id);
  if (!record) return false;
  const { customName: _previous, ...rest } = record;
  const customName = name.trim();
  const renamed: DraftRecord = customName ? { ...rest, customName } : rest;
  try {
    await backend.put(renamed);
  } catch {
    return false;
  }
  upsertSummary(summaryOf(renamed));
  return true;
}

/** Deletes draft `id` and resolves with it, for `restoreDraft` to undo; null when there was none. */
export async function deleteDraft(id: string): Promise<DraftRecord | null> {
  if (pending?.id === id) cancelPending();
  const record = await getDraft(id);
  try {
    await backend.remove(id);
  } catch {
    return null;
  }
  useDrafts.setState({ drafts: useDrafts.getState().drafts.filter((draft) => draft.id !== id) });
  if (useDrafts.getState().rememberedId === id) remember(null);
  if (latest?.id === id) latest = null;
  return record;
}

/** Puts a deleted draft back as it was, in the same place in the list. */
export async function restoreDraft(record: DraftRecord): Promise<boolean> {
  try {
    await backend.put(record);
  } catch {
    return false;
  }
  upsertSummary(summaryOf(record));
  return true;
}

/** The draft as last saved, for the crash screen's "Download draft": the open one, else the one last open. */
export function rawDraft(): string | null {
  return latest ? JSON.stringify(latest.project) : null;
}

/**
 * Keeps the open draft stored: a new draft is written at once, edits shortly after they stop, a new baseline at
 * once, and the draft left by opening another one or closing the workspace keeps its last edits. Returns the
 * unsubscribe function.
 */
export function startAutosave(): () => void {
  const unsubscribe = useStore.subscribe((state, previous) => {
    const { draftId, project, baseline } = state;
    if (draftId !== previous.draftId) {
      void flush();
      if (!draftId || !project) return;
      latest = { id: draftId, project };
      remember(draftId);
      if (!useDrafts.getState().drafts.some((draft) => draft.id === draftId)) void writeDraft(draftId, project, baseline);
      return;
    }
    if (!draftId || !project) return;
    if (baseline !== previous.baseline) {
      // Written with the edits still waiting, if any.
      cancelPending();
      void writeDraft(draftId, project, baseline);
      return;
    }
    if (project === previous.project) return;
    cancelPending();
    pending = { id: draftId, project, baseline, timer: setTimeout(() => void flush(), AUTOSAVE_DELAY_MS) };
  });
  return () => {
    cancelPending();
    unsubscribe();
  };
}
