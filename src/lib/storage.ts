import type { ItemState } from './srs';

const KEY = 'llh:v1:progress';

export type Progress = {
  items: ItemState[];
  streak: { lastSessionDay: string | null; count: number };
  stats: { totalAttempts: number; totalAdvances: number };
};

const empty: Progress = {
  items: [],
  streak: { lastSessionDay: null, count: 0 },
  stats: { totalAttempts: 0, totalAdvances: 0 },
};

export function loadProgress(): Progress {
  if (typeof window === 'undefined') return structuredClone(empty);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(empty);
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      items: parsed.items ?? [],
      streak: parsed.streak ?? { lastSessionDay: null, count: 0 },
      stats: parsed.stats ?? { totalAttempts: 0, totalAdvances: 0 },
    };
  } catch {
    return structuredClone(empty);
  }
}

export function saveProgress(p: Progress): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function resetProgress(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
}
