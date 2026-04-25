import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayKey, nextStreak, SessionManager } from './session';
import { isMastered, MASTERY_LEVEL } from './srs';
import type { LexiconEntry } from './lexicon';

const FIXTURE: LexiconEntry[] = [
  { id: 'a', en: 'a', ru: 'а', phonetic: 'AH', category: 'cat1', tier: 1, scenario: 'approach-greet', seq: 1 },
  { id: 'b', en: 'b', ru: 'б', phonetic: 'BEH', category: 'cat1', tier: 1, scenario: 'approach-greet', seq: 2 },
  { id: 'c', en: 'c', ru: 'в', phonetic: 'VEH', category: 'cat2', tier: 2, scenario: 'compliment-flirt', seq: 1 },
];

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  });
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nextStreak', () => {
  it('starts at 1 from null', () => {
    expect(nextStreak({ lastSessionDay: null, count: 0 }, '2026-04-23')).toEqual(
      { lastSessionDay: '2026-04-23', count: 1 },
    );
  });
  it('does not double-count same day', () => {
    expect(
      nextStreak({ lastSessionDay: '2026-04-23', count: 4 }, '2026-04-23'),
    ).toEqual({ lastSessionDay: '2026-04-23', count: 4 });
  });
  it('increments on consecutive day', () => {
    expect(
      nextStreak({ lastSessionDay: '2026-04-22', count: 3 }, '2026-04-23'),
    ).toEqual({ lastSessionDay: '2026-04-23', count: 4 });
  });
  it('resets after a gap', () => {
    expect(
      nextStreak({ lastSessionDay: '2026-04-20', count: 7 }, '2026-04-23'),
    ).toEqual({ lastSessionDay: '2026-04-23', count: 1 });
  });
});

describe('dayKey', () => {
  it('returns YYYY-MM-DD format', () => {
    const k = dayKey(new Date(2026, 3, 23, 14, 30).getTime());
    expect(k).toBe('2026-04-23');
  });
});

describe('isMastered', () => {
  it('false below mastery level', () => {
    expect(isMastered({ level: MASTERY_LEVEL - 1 })).toBe(false);
  });
  it('true at and above mastery level', () => {
    expect(isMastered({ level: MASTERY_LEVEL })).toBe(true);
    expect(isMastered({ level: MASTERY_LEVEL + 2 })).toBe(true);
  });
});

describe('SessionManager.getStats', () => {
  it('reports zero introduced/mastered on a fresh manager', () => {
    const mgr = new SessionManager(FIXTURE);
    const s = mgr.getStats();
    expect(s.totalEntries).toBe(3);
    expect(s.introduced).toBe(0);
    expect(s.mastered).toBe(0);
    expect(s.streak).toBe(0);
  });

  it('counts introduced and mastered after attempts', () => {
    const mgr = new SessionManager(FIXTURE);
    mgr.recordAttempt('a', 1); // level 0 -> 1, introduced
    const s = mgr.getStats();
    expect(s.introduced).toBe(1);
    expect(s.mastered).toBe(0);
    expect(s.streak).toBe(1);
  });

  it('marks an item mastered after enough advances', () => {
    const mgr = new SessionManager(FIXTURE);
    for (let i = 0; i < MASTERY_LEVEL; i++) {
      mgr.recordAttempt('a', 1);
    }
    expect(mgr.getStats().mastered).toBe(1);
  });

  it('breaks down per category with totals', () => {
    const mgr = new SessionManager(FIXTURE);
    mgr.recordAttempt('a', 1);
    const cats = mgr.getStats().perCategory;
    const cat1 = cats.find((c) => c.category === 'cat1')!;
    const cat2 = cats.find((c) => c.category === 'cat2')!;
    expect(cat1.total).toBe(2);
    expect(cat1.introduced).toBe(1);
    expect(cat2.total).toBe(1);
    expect(cat2.introduced).toBe(0);
  });

  it('drops items whose lexicon entry was removed', () => {
    const mgr1 = new SessionManager(FIXTURE);
    mgr1.recordAttempt('a', 1);
    // Re-instantiate with a smaller lexicon — id 'a' is gone.
    const mgr2 = new SessionManager(FIXTURE.filter((e) => e.id !== 'a'));
    const s = mgr2.getStats();
    expect(s.totalEntries).toBe(2);
    // Stale 'a' state should not have been carried over.
    expect(s.introduced).toBe(0);
  });
});
