export const TOUR_SEEN_KEY = 'credential-toolkit:tour-seen';

/** Whether this browser has finished or skipped the workspace tour. Unreadable storage counts as not seen. */
export function loadTourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Storage may be unavailable or full; the tour then shows again next time.
  }
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Placement = 'right' | 'left' | 'bottom' | 'top' | 'center' | 'dock';

/** Space between the card and the area it explains, and the least space it keeps from the window edges. */
const GAP = 12;
const MARGIN = 16;
/** How far the spotlight reaches past the area, and how far it stays inside the window. */
const SPOT_PADDING = 4;
const SPOT_INSET = 4;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where the tour card goes: beside a tall area (a pane) or below or above a short one (the top bar)
 * when it fits there, else on any other side that fits. It is centred when there is no area, and
 * docked at the bottom of the window when the area fills it (a pane on a phone, the translations table).
 */
export function placeCard(target: Box | null, card: Size, viewport: Size): { top: number; left: number; placement: Placement } {
  const maxLeft = viewport.width - card.width - MARGIN;
  const maxTop = viewport.height - card.height - MARGIN;
  if (!target) {
    return { placement: 'center', left: clamp((viewport.width - card.width) / 2, MARGIN, maxLeft), top: clamp((viewport.height - card.height) / 2, MARGIN, maxTop) };
  }
  const beside = clamp(target.top, MARGIN, maxTop);
  const centred = clamp(target.left + (target.width - card.width) / 2, MARGIN, maxLeft);
  const candidates: Array<{ placement: Placement; left: number; top: number; fits: boolean }> = [
    { placement: 'right', left: target.left + target.width + GAP, top: beside, fits: target.left + target.width + GAP + card.width <= viewport.width - MARGIN },
    { placement: 'left', left: target.left - GAP - card.width, top: beside, fits: target.left - GAP - card.width >= MARGIN },
    { placement: 'bottom', left: centred, top: target.top + target.height + GAP, fits: target.top + target.height + GAP + card.height <= viewport.height - MARGIN },
    { placement: 'top', left: centred, top: target.top - GAP - card.height, fits: target.top - GAP - card.height >= MARGIN },
  ];
  const order = target.height < card.height ? [2, 3, 0, 1] : [0, 1, 2, 3];
  const chosen = order.map((index) => candidates[index]).find((candidate) => candidate.fits);
  if (chosen) return { placement: chosen.placement, left: chosen.left, top: chosen.top };
  return { placement: 'dock', left: clamp((viewport.width - card.width) / 2, MARGIN, maxLeft), top: clamp(maxTop, MARGIN, maxTop) };
}

/** The lit box around an area: a little larger than the area, but kept inside the window so its outline shows. */
export function spotlightBox(target: Box, viewport: Size): Box {
  const top = Math.max(target.top - SPOT_PADDING, SPOT_INSET);
  const left = Math.max(target.left - SPOT_PADDING, SPOT_INSET);
  const bottom = Math.min(target.top + target.height + SPOT_PADDING, viewport.height - SPOT_INSET);
  const right = Math.min(target.left + target.width + SPOT_PADDING, viewport.width - SPOT_INSET);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
