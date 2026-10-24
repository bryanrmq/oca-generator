import { useCallback, useEffect, useState } from 'react';
import {
  I14Y_API,
  type I14yConcept,
  type I14yHit,
  type I14yLanguage,
  conceptsToLoad,
  fillFromI14y,
  linkConcept,
  parseCatalogue,
  parseConcept,
  parseSearchResults,
} from '../../core/import/i14y';
import { endTyping, useStore } from '../../state/store';
import { t } from '../../strings';

/** I14Y answers every search in full; the dialog lists this many at most. */
const MAX_HITS = 50;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`I14Y answered ${response.status}`);
  return response.json();
}

/** Concepts matching `query`, best registration status first. Rejects when I14Y can't be reached. */
export async function searchConcepts(query: string, language: I14yLanguage, signal?: AbortSignal): Promise<I14yHit[]> {
  const params = new URLSearchParams({ query, language, types: 'Concept', pageSize: String(MAX_HITS) });
  return parseSearchResults(await getJson(`${I14Y_API}/search?${params}`, signal)).slice(0, MAX_HITS);
}

export function statusTone(status: string): 'green' | 'blue' | 'gray' {
  if (status === 'PreferredStandard' || status === 'Standard') return 'green';
  return status === 'Qualified' ? 'blue' : 'gray';
}

/** "PreferredStandard" → "Preferred standard". */
export function statusLabel(status: string): string {
  const words = status.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The concept's page on the I14Y website, in the editing language when the site has it. */
export function conceptPageUrl(conceptId: string, language: I14yLanguage | undefined): string {
  const lang = language && language !== 'rm' ? language : 'de';
  return `https://www.i14y.admin.ch/${lang}/catalog/concepts/${encodeURIComponent(conceptId)}/description`;
}

/** One concept with its code list values. */
export async function fetchConcept(id: string, signal?: AbortSignal): Promise<I14yConcept> {
  return parseConcept(await getJson(`${I14Y_API}/concepts/${encodeURIComponent(id)}?includeCodeListEntries=true`, signal));
}

export const CATALOGUE_CACHE_KEY = 'credential-toolkit:i14y-catalogue';
/** I14Y's concept list changes slowly, and a picked concept is always fetched fresh, so a week-old list is fine. */
export const CATALOGUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The whole public catalogue fits in one page today (646 concepts); later pages are fetched if it grows. */
const CATALOGUE_PAGE_SIZE = 1000;

interface CachedCatalogue {
  fetchedAt: number;
  concepts: I14yHit[];
}

function isHit(value: unknown): value is I14yHit {
  const candidate = value as Partial<I14yHit> | null;
  return typeof candidate?.id === 'string' && typeof candidate.identifier === 'string' && typeof candidate.name === 'object' && candidate.name !== null;
}

function loadCachedCatalogue(): CachedCatalogue | null {
  try {
    const stored = JSON.parse(localStorage.getItem(CATALOGUE_CACHE_KEY) ?? 'null') as Partial<CachedCatalogue> | null;
    return typeof stored?.fetchedAt === 'number' && Array.isArray(stored.concepts) && stored.concepts.every(isHit) ? (stored as CachedCatalogue) : null;
  } catch {
    return null;
  }
}

function saveCachedCatalogue(concepts: I14yHit[]): void {
  try {
    localStorage.setItem(CATALOGUE_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), concepts }));
  } catch {
    // Storage may be unavailable or full; the catalogue is then fetched again next time.
  }
}

async function fetchCatalogue(): Promise<I14yHit[]> {
  const data: unknown[] = [];
  for (let page = 1; ; page++) {
    const body = await getJson(`${I14Y_API}/concepts?page=${page}&pageSize=${CATALOGUE_PAGE_SIZE}`);
    const items = body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : [];
    data.push(...items);
    if (items.length < CATALOGUE_PAGE_SIZE) break;
  }
  return parseCatalogue({ data });
}

let catalogue: I14yHit[] | null = null;
let loading: Promise<I14yHit[] | null> | null = null;

/**
 * Every public I14Y concept, for matching what the issuer types without sending it anywhere. Read
 * from this browser's cache while it is under a week old; null when I14Y can't be reached and
 * nothing is cached.
 */
export function loadCatalogue(): Promise<I14yHit[] | null> {
  loading ??= (async () => {
    const cached = loadCachedCatalogue();
    if (cached && Date.now() - cached.fetchedAt < CATALOGUE_MAX_AGE_MS) return (catalogue = cached.concepts);
    try {
      const fetched = await fetchCatalogue();
      saveCachedCatalogue(fetched);
      return (catalogue = fetched);
    } catch {
      loading = null;
      return (catalogue = cached?.concepts ?? null);
    }
  })();
  return loading;
}

/**
 * The I14Y catalogue once loaded. Nothing is fetched until `request` is called, for example when a
 * field gets focus, or right away with `load`; after a failed load, the next request tries again.
 */
export function useI14yCatalogue(load = false): { catalogue: I14yHit[] | null; request: () => void } {
  const [current, setCurrent] = useState(catalogue);
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if ((requests === 0 && !load) || current) return;
    let active = true;
    void loadCatalogue().then((loaded) => active && setCurrent(loaded));
    return () => {
      active = false;
    };
  }, [requests, load, current]);
  const request = useCallback(() => setRequests((count) => count + 1), []);
  return { catalogue: current, request };
}

/** Links attributes to I14Y concepts, fetching each concept for its value labels. Texts stay as they are. */
export async function linkToI14y(links: { nodeId: string; conceptId: string }[]): Promise<void> {
  const { update, setReport } = useStore.getState();
  try {
    const concepts = await Promise.all(links.map((link) => fetchConcept(link.conceptId)));
    update((draft) => links.forEach((link, index) => linkConcept(draft, link.nodeId, concepts[index])));
  } catch {
    setReport([{ level: 'warning', message: t.i14y.unreachable }]);
  }
}

let filling = false;

/**
 * Fills the empty labels and value labels of linked attributes from their I14Y concepts, each marked for review,
 * as one undo step, and says how many in the toast with Undo. Concepts whose link carries no texts are fetched
 * first, as linking does; the toast names those that could not be loaded.
 */
export async function fillMissingFromI14y(): Promise<void> {
  const start = useStore.getState().project;
  if (filling || !start) return;
  filling = true;
  try {
    const toLoad = conceptsToLoad(start);
    const results = await Promise.allSettled(toLoad.map((concept) => fetchConcept(concept.conceptId)));
    const concepts = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failed = toLoad.filter((_, index) => results[index].status === 'rejected').map((concept) => concept.identifier);
    // The project may have changed while the concepts loaded: fill the one open now.
    const { project, update, showUndoable, showError } = useStore.getState();
    if (!project) return;
    const filled = fillFromI14y(structuredClone(project), concepts);
    if (filled === 0) {
      showError(t.i14yFill.nothing(failed));
      return;
    }
    endTyping();
    update((draft) => void fillFromI14y(draft, concepts));
    endTyping();
    showUndoable(t.i14yFill.filled(filled, failed), () => useStore.getState().undo());
  } finally {
    filling = false;
  }
}
