import { describe, expect, it } from 'vitest';
import {
  grade,
  newItem,
  outcomeFromScore,
  pickSessionQueue,
  PIMSLEUR_INTERVALS_SECONDS,
} from './srs';

describe('outcomeFromScore', () => {
  it('exact match advances', () => {
    expect(outcomeFromScore(1)).toBe('advance');
  });
  it('close holds', () => {
    expect(outcomeFromScore(0.95)).toBe('hold');
    expect(outcomeFromScore(0.9)).toBe('hold');
  });
  it('miss demotes', () => {
    expect(outcomeFromScore(0.89)).toBe('demote');
    expect(outcomeFromScore(0)).toBe('demote');
  });
});

describe('grade', () => {
  const NOW = 1_000_000_000_000;

  it('advances on exact match', () => {
    const item = newItem('x', NOW);
    const next = grade(item, 1, NOW);
    expect(next.level).toBe(1);
    expect(next.dueAt).toBe(NOW + PIMSLEUR_INTERVALS_SECONDS[1] * 1000);
    expect(next.introduced).toBe(true);
    expect(next.consecutiveCorrect).toBe(1);
  });

  it('does not exceed max level', () => {
    const item = { ...newItem('x', NOW), level: PIMSLEUR_INTERVALS_SECONDS.length - 1 };
    const next = grade(item, 1, NOW);
    expect(next.level).toBe(PIMSLEUR_INTERVALS_SECONDS.length - 1);
  });

  it('holds on near match without changing level', () => {
    const item = { ...newItem('x', NOW), level: 3 };
    const next = grade(item, 0.95, NOW);
    expect(next.level).toBe(3);
    expect(next.consecutiveCorrect).toBe(0);
    expect(next.dueAt).toBeGreaterThan(NOW);
  });

  it('demotes on miss and requeues soon', () => {
    const item = { ...newItem('x', NOW), level: 2, consecutiveCorrect: 3 };
    const next = grade(item, 0.5, NOW);
    expect(next.level).toBe(1);
    expect(next.consecutiveCorrect).toBe(0);
    expect(next.dueAt).toBe(NOW + 30_000);
  });

  it('floor at level 0 on miss', () => {
    const item = newItem('x', NOW);
    const next = grade(item, 0, NOW);
    expect(next.level).toBe(0);
  });
});

describe('pickSessionQueue', () => {
  const NOW = 1_000_000_000_000;

  it('returns due items before new items', () => {
    const items = [
      { ...newItem('a', NOW), introduced: true, dueAt: NOW - 1000 },
    ];
    const result = pickSessionQueue(items, ['a', 'b', 'c'], { now: NOW, newPerSession: 1 });
    expect(result).toEqual(['a', 'b']);
  });

  it('treats un-introduced items as new even if they have state', () => {
    const items = [
      { ...newItem('b', NOW), introduced: false, dueAt: NOW },
    ];
    const result = pickSessionQueue(items, ['a', 'b', 'c'], { now: NOW, newPerSession: 2 });
    expect(result).toEqual(['a', 'b']);
  });

  it('respects newPerSession cap', () => {
    const items: ReturnType<typeof newItem>[] = [];
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const result = pickSessionQueue(items, ids, { now: NOW, newPerSession: 3 });
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('skips items not yet due', () => {
    const items = [
      { ...newItem('a', NOW), introduced: true, dueAt: NOW + 60_000 },
    ];
    const result = pickSessionQueue(items, ['a'], { now: NOW, newPerSession: 0 });
    expect(result).toEqual([]);
  });

  it('clamps due-item selection to the supplied scope (regression: scenario isolation)', () => {
    // 'a' and 'b' are both globally due; only 'b' is in scope.
    const items = [
      { ...newItem('a', NOW), introduced: true, dueAt: NOW - 5000 },
      { ...newItem('b', NOW), introduced: true, dueAt: NOW - 1000 },
    ];
    const result = pickSessionQueue(items, ['b', 'c'], { now: NOW, newPerSession: 1 });
    // 'a' must NOT leak in even though it's due — it's outside scope.
    expect(result).toEqual(['b', 'c']);
  });
});
