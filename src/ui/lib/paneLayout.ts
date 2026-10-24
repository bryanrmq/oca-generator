
/** The pane a narrow window shows (below 1000 px only one fits); there the Issues panel is a pane too. */
export type WorkspacePane = 'structure' | 'inspector' | 'output' | 'issues';
export type ResizablePane = 'structure' | 'output';
export type PaneWidths = Record<ResizablePane, number>;

export const PANE_LAYOUT_KEY = 'credential-toolkit:pane-widths';
export const DEFAULT_PANE_WIDTHS: PaneWidths = { structure: 300, output: 420 };
export const PANE_LIMITS: Record<ResizablePane, [min: number, max: number]> = { structure: [220, 520], output: [300, 720] };
/** Room the Edit pane always keeps, and the width of the two resize handles together. */
const EDIT_PANE_MIN = 420;
const HANDLES_WIDTH = 10;

/**
 * Clamps a pane width to its limits and, when the window width is known, to the room left once
 * the other side pane and the Edit pane's minimum are taken (never below the pane's own minimum).
 */
export function clampPaneWidth(pane: ResizablePane, width: number, room?: { container: number; other: number }): number {
  const [min, max] = PANE_LIMITS[pane];
  const roomMax = room && room.container > 0 ? room.container - room.other - EDIT_PANE_MIN - HANDLES_WIDTH : max;
  return Math.round(Math.max(min, Math.min(width, max, roomMax)));
}

/** The JSON value saved under `key`, or null when there is none, it is not JSON or storage is unavailable. */
function loadStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function saveStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full; the layout then lasts until the page is closed.
  }
}

export function loadPaneWidths(): PaneWidths {
  const stored = loadStored(PANE_LAYOUT_KEY);
  if (typeof stored !== 'object' || stored === null) return { ...DEFAULT_PANE_WIDTHS };
  const { structure, output } = stored as Record<string, unknown>;
  if (typeof structure !== 'number' || typeof output !== 'number') return { ...DEFAULT_PANE_WIDTHS };
  return { structure: clampPaneWidth('structure', structure), output: clampPaneWidth('output', output) };
}

export function savePaneWidths(widths: PaneWidths): void {
  saveStored(PANE_LAYOUT_KEY, widths);
}

export const ISSUES_HEIGHT_KEY = 'credential-toolkit:issues-height';
export const DEFAULT_ISSUES_HEIGHT = 200;
export const ISSUES_HEIGHT_LIMITS: [min: number, max: number] = [96, 640];
/** Height the panes above the Issues panel always keep. */
const PANES_MIN_HEIGHT = 160;

/**
 * Clamps the height of the Issues panel's list to its limits and, when the room is known (the panes' height plus
 * the list's own), to what is left once the panes keep their minimum (never below the list's own minimum).
 */
export function clampIssuesHeight(height: number, room?: number): number {
  const [min, max] = ISSUES_HEIGHT_LIMITS;
  const roomMax = room && room > 0 ? room - PANES_MIN_HEIGHT : max;
  return Math.round(Math.max(min, Math.min(height, max, roomMax)));
}

export function loadIssuesHeight(): number {
  const stored = loadStored(ISSUES_HEIGHT_KEY);
  return typeof stored === 'number' ? clampIssuesHeight(stored) : DEFAULT_ISSUES_HEIGHT;
}

export function saveIssuesHeight(height: number): void {
  saveStored(ISSUES_HEIGHT_KEY, height);
}

export const ISSUES_OPEN_KEY = 'credential-toolkit:issues-open';

/** Whether the Issues panel is open (not collapsed to its header); open unless the user collapsed it. */
export function loadIssuesOpen(): boolean {
  return loadStored(ISSUES_OPEN_KEY) !== false;
}

export function saveIssuesOpen(open: boolean): void {
  saveStored(ISSUES_OPEN_KEY, open);
}

export const OUTPUT_OPEN_KEY = 'credential-toolkit:output-open';

/** Whether a wide window shows the Output pane; shown unless the user hid it. */
export function loadOutputOpen(): boolean {
  return loadStored(OUTPUT_OPEN_KEY) !== false;
}

export function saveOutputOpen(open: boolean): void {
  saveStored(OUTPUT_OPEN_KEY, open);
}

export const EDIT_PREVIEW_OPEN_KEY = 'credential-toolkit:edit-preview-open';

/**
 * Whether the wallet preview under the form (an Edit pane narrower than the preview column needs) shows its body,
 * not only its header; open unless the user collapsed it.
 */
export function loadEditPreviewOpen(): boolean {
  return loadStored(EDIT_PREVIEW_OPEN_KEY) !== false;
}

export function saveEditPreviewOpen(open: boolean): void {
  saveStored(EDIT_PREVIEW_OPEN_KEY, open);
}
