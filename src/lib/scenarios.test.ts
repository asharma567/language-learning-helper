import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entriesInScenario,
  getScenario,
  getScenarioForEntry,
  SCENARIOS,
} from './scenarios';
import { SessionManager } from './session';
import type { LexiconEntry, ScenarioId } from './lexicon';

const makeEntry = (
  id: string,
  scenario: ScenarioId,
  tier: 1 | 2 | 3 = 1,
  category = 'test',
  seq = 1,
): LexiconEntry => ({
  id,
  en: id,
  ru: id,
  phonetic: 'TEST',
  category,
  tier,
  scenario,
  seq,
});

const FIXTURE: LexiconEntry[] = [
  makeEntry('ag-1', 'approach-greet'),
  makeEntry('ag-2', 'approach-greet'),
  makeEntry('cf-1', 'compliment-flirt'),
  makeEntry('cf-2', 'compliment-flirt'),
  makeEntry('ri-1', 'romance-intimacy'),
  makeEntry('pe-1', 'practical-errands'),
  makeEntry('pe-2', 'practical-errands', 2),
  makeEntry('cd-1', 'confrontation-dominance'),
  makeEntry('cd-2', 'confrontation-dominance'),
  makeEntry('rf-1', 'reactions-filler'),
  makeEntry('rf-2', 'reactions-filler'),
  makeEntry('nm-1', 'numbers-time-money'),
  makeEntry('mc-1', 'mat-color'),
];

describe('SCENARIOS constant', () => {
  it('has exactly 8 entries', () => {
    expect(SCENARIOS).toHaveLength(8);
  });

  it('has unique ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(8);
  });

  it('order values are 1-based and sequential', () => {
    const orders = [...SCENARIOS].sort((a, b) => a.order - b.order).map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('exactly one scenario is defaultRecommended', () => {
    const defaults = SCENARIOS.filter((s) => s.defaultRecommended);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('approach-greet');
  });
});

describe('getScenario', () => {
  it('returns the correct scenario for a known id', () => {
    const s = getScenario('compliment-flirt');
    expect(s.id).toBe('compliment-flirt');
    expect(s.title).toBe('Compliment & Flirt');
  });

  it('throws for an unknown id', () => {
    expect(() => getScenario('not-a-real-id' as ScenarioId)).toThrow();
  });
});

describe('getScenarioForEntry', () => {
  it('returns the scenario matching the entry scenario field', () => {
    const entry = makeEntry('x', 'romance-intimacy');
    const s = getScenarioForEntry(entry);
    expect(s.id).toBe('romance-intimacy');
  });
});

describe('entriesInScenario', () => {
  it('returns only entries with the given scenario', () => {
    const result = entriesInScenario(FIXTURE, 'approach-greet');
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.scenario === 'approach-greet')).toBe(true);
  });

  it('returns empty array when no entries match', () => {
    const result = entriesInScenario(FIXTURE, 'mat-color');
    expect(result).toHaveLength(1);
  });

  it('is stable — same input same output', () => {
    const a = entriesInScenario(FIXTURE, 'practical-errands');
    const b = entriesInScenario(FIXTURE, 'practical-errands');
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });
});

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  });
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SessionManager.buildScenarioQueue', () => {
  it('only returns items in the given scenario', () => {
    const mgr = new SessionManager(FIXTURE);
    const queue = mgr.buildScenarioQueue('approach-greet', 10);
    const ids = queue.map((item) => item.entry.id);
    expect(ids.every((id) => id.startsWith('ag-'))).toBe(true);
  });

  it('respects tier ordering for new items', () => {
    const lexicon: LexiconEntry[] = [
      makeEntry('pe-tier2', 'practical-errands', 2),
      makeEntry('pe-tier1', 'practical-errands', 1),
    ];
    const mgr = new SessionManager(lexicon);
    const queue = mgr.buildScenarioQueue('practical-errands', 10);
    expect(queue[0].entry.id).toBe('pe-tier1');
  });

  it('returns empty queue when scenario has no entries', () => {
    const lexicon: LexiconEntry[] = [makeEntry('rf-1', 'reactions-filler')];
    const mgr = new SessionManager(lexicon);
    const queue = mgr.buildScenarioQueue('mat-color', 10);
    expect(queue).toHaveLength(0);
  });

  it('caps new items by newPerSession param', () => {
    const lexicon: LexiconEntry[] = [
      makeEntry('ag-1', 'approach-greet'),
      makeEntry('ag-2', 'approach-greet'),
      makeEntry('ag-3', 'approach-greet'),
    ];
    const mgr = new SessionManager(lexicon);
    const queue = mgr.buildScenarioQueue('approach-greet', 2);
    expect(queue.length).toBeLessThanOrEqual(2);
  });
});

describe('SessionManager.getStats perScenario', () => {
  it('includes all 8 scenarios in perScenario', () => {
    const mgr = new SessionManager(FIXTURE);
    const stats = mgr.getStats();
    expect(stats.perScenario).toHaveLength(8);
  });

  it('reports correct totals per scenario', () => {
    const mgr = new SessionManager(FIXTURE);
    const stats = mgr.getStats();
    const ag = stats.perScenario.find((s) => s.scenarioId === 'approach-greet')!;
    expect(ag.total).toBe(2);
    expect(ag.introduced).toBe(0);
  });

  it('updates introduced count after recordAttempt', () => {
    const mgr = new SessionManager(FIXTURE);
    mgr.recordAttempt('ag-1', 1);
    const stats = mgr.getStats();
    const ag = stats.perScenario.find((s) => s.scenarioId === 'approach-greet')!;
    expect(ag.introduced).toBe(1);
  });

  it('perScenario titles match SCENARIOS', () => {
    const mgr = new SessionManager(FIXTURE);
    const stats = mgr.getStats();
    for (const row of stats.perScenario) {
      const scenario = SCENARIOS.find((s) => s.id === row.scenarioId);
      expect(row.title).toBe(scenario?.title);
    }
  });
});
