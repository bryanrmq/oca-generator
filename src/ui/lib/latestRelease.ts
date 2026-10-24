import { useEffect, useState } from 'react';

export const RELEASE_CACHE_KEY = 'credential-toolkit:latest-release';
export const RELEASES_API = 'https://api.github.com/repos/bryanrmq/credential-toolkit/releases/latest';
/** How long a fetched release is trusted before asking GitHub again (its API allows 60 calls an hour per visitor). */
export const RELEASE_MAX_AGE_MS = 60 * 60 * 1000;

export interface Release {
  tag: string;
  url: string;
}
interface CachedRelease extends Release {
  fetchedAt: number;
}

function isRelease(value: unknown): value is Release {
  const candidate = value as Partial<Release> | null;
  return (
    typeof candidate?.tag === 'string' &&
    /^v\d+\.\d+\.\d+$/.test(candidate.tag) &&
    typeof candidate.url === 'string' &&
    candidate.url.startsWith('https://github.com/')
  );
}

/** The last release this browser fetched, however old. Unreadable or malformed storage counts as none. */
export function loadCachedRelease(): CachedRelease | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RELEASE_CACHE_KEY) ?? 'null');
    return isRelease(stored) && typeof (stored as CachedRelease).fetchedAt === 'number' ? (stored as CachedRelease) : null;
  } catch {
    return null;
  }
}

function saveCachedRelease(release: Release, fetchedAt: number): void {
  try {
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({ ...release, fetchedAt }));
  } catch {
    // Storage may be unavailable or full; the release is then fetched again next time.
  }
}

/** The latest GitHub Release, or null when there is none yet or GitHub can't be reached. */
export async function fetchLatestRelease(): Promise<Release | null> {
  try {
    const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const release = { tag: body.tag_name, url: body.html_url };
    return isRelease(release) ? release : null;
  } catch {
    return null;
  }
}

/**
 * The latest release, read from GitHub so the app shows it without a rebuild. The cached one shows
 * straight away and is refreshed once it is older than an hour; null until any release is known.
 */
export function useLatestRelease(): Release | null {
  const [release, setRelease] = useState<Release | null>(() => {
    const cached = loadCachedRelease();
    return cached && { tag: cached.tag, url: cached.url };
  });
  useEffect(() => {
    const cached = loadCachedRelease();
    if (cached && Date.now() - cached.fetchedAt < RELEASE_MAX_AGE_MS) return;
    let active = true;
    void fetchLatestRelease().then((latest) => {
      if (!latest) return;
      saveCachedRelease(latest, Date.now());
      if (active) setRelease(latest);
    });
    return () => {
      active = false;
    };
  }, []);
  return release;
}
