import { describe, expect, it } from 'vitest';
import { pickQuickMatchSet } from './quickmatch';
import type { LexiconEntry, ScenarioId } from './lexicon';

const makeEntry = (
  id: string,
  scenario: ScenarioId,
  category = 'cat-a',
  tier: 1 | 2 | 3 = 1,
  seq = 1,
  lesson = 1,
): LexiconEntry => ({
  id,
  en: id,
  ru: id,
  phonetic: 'TEST',
  category,
  tier,
  scenario,
  seq,
  lesson,
});

const deterministicRand = (seq: number[]) => {
  let i = 0;
  return () => seq[i++ % seq.length];
};

describe('pickQuickMatchSet', () => {
  it('returns the target unchanged', () => {
    const target = makeEntry('t', 'approach-greet');
    const lexicon = [
      target,
      makeEntry('a', 'approach-greet'),
      makeEntry('b', 'approach-greet'),
      makeEntry('c', 'approach-greet'),
    ];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    expect(result.target).toBe(target);
  });

  it('returns exactly 3 distractors', () => {
    const target = makeEntry('t', 'approach-greet');
    const lexicon = [
      target,
      makeEntry('a', 'approach-greet'),
      makeEntry('b', 'approach-greet'),
      makeEntry('c', 'approach-greet'),
    ];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    expect(result.distractors).toHaveLength(3);
  });

  it('distractors do not include the target', () => {
    const target = makeEntry('t', 'approach-greet');
    const lexicon = [
      target,
      makeEntry('a', 'approach-greet'),
      makeEntry('b', 'approach-greet'),
      makeEntry('c', 'approach-greet'),
    ];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    expect(result.distractors.every((d) => d.id !== target.id)).toBe(true);
  });

  it('distractors are unique', () => {
    const target = makeEntry('t', 'approach-greet');
    const lexicon = [
      target,
      makeEntry('a', 'approach-greet'),
      makeEntry('b', 'approach-greet'),
      makeEntry('c', 'approach-greet'),
    ];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    const ids = result.distractors.map((d) => d.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('prefers same-scenario distractors when available', () => {
    const target = makeEntry('t', 'approach-greet', 'cat-a');
    const sameScenario = [
      makeEntry('ag-1', 'approach-greet', 'cat-a'),
      makeEntry('ag-2', 'approach-greet', 'cat-a'),
      makeEntry('ag-3', 'approach-greet', 'cat-a'),
    ];
    const otherScenario = [
      makeEntry('cf-1', 'compliment-flirt', 'cat-b'),
      makeEntry('cf-2', 'compliment-flirt', 'cat-b'),
    ];
    const lexicon = [target, ...sameScenario, ...otherScenario];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    const distractorIds = result.distractors.map((d) => d.id);
    expect(distractorIds.every((id) => id.startsWith('ag-'))).toBe(true);
  });

  it('falls back to same-category when same-scenario is exhausted', () => {
    const target = makeEntry('t', 'approach-greet', 'cat-a');
    const sameScenarioSameCat = [makeEntry('ag-1', 'approach-greet', 'cat-a')];
    const sameCatDiffScenario = [
      makeEntry('cf-cat-a-1', 'compliment-flirt', 'cat-a'),
      makeEntry('cf-cat-a-2', 'compliment-flirt', 'cat-a'),
    ];
    const lexicon = [target, ...sameScenarioSameCat, ...sameCatDiffScenario];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    const ids = result.distractors.map((d) => d.id);
    expect(ids).toContain('ag-1');
    expect(ids.some((id) => id.startsWith('cf-cat-a'))).toBe(true);
  });

  it('falls back to anything when same-scenario and same-category are exhausted', () => {
    const target = makeEntry('t', 'approach-greet', 'cat-a');
    const lexicon = [
      target,
      makeEntry('d1', 'compliment-flirt', 'cat-b'),
      makeEntry('d2', 'romance-intimacy', 'cat-c'),
      makeEntry('d3', 'practical-errands', 'cat-d'),
    ];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    expect(result.distractors).toHaveLength(3);
    expect(result.distractors.every((d) => d.id !== target.id)).toBe(true);
  });

  it('throws when lexicon is too small to fill 3 distractors', () => {
    const target = makeEntry('t', 'approach-greet');
    const lexicon = [target, makeEntry('a', 'approach-greet'), makeEntry('b', 'approach-greet')];
    expect(() => pickQuickMatchSet(lexicon, target)).toThrow();
  });

  it('is deterministic for the same random seed sequence', () => {
    const target = makeEntry('t', 'approach-greet', 'cat-a');
    const lexicon = [
      target,
      makeEntry('a', 'approach-greet', 'cat-a'),
      makeEntry('b', 'approach-greet', 'cat-a'),
      makeEntry('c', 'approach-greet', 'cat-a'),
      makeEntry('d', 'compliment-flirt', 'cat-b'),
    ];
    const rand1 = deterministicRand([0.1, 0.5, 0.9]);
    const rand2 = deterministicRand([0.1, 0.5, 0.9]);
    const r1 = pickQuickMatchSet(lexicon, target, { random: rand1 });
    const r2 = pickQuickMatchSet(lexicon, target, { random: rand2 });
    expect(r1.distractors.map((d) => d.id)).toEqual(r2.distractors.map((d) => d.id));
  });

  it('works with minimum viable lexicon of exactly 4 entries', () => {
    const target = makeEntry('t', 'approach-greet');
    const lexicon = [
      target,
      makeEntry('x1', 'compliment-flirt', 'cat-b'),
      makeEntry('x2', 'romance-intimacy', 'cat-c'),
      makeEntry('x3', 'practical-errands', 'cat-d'),
    ];
    const result = pickQuickMatchSet(lexicon, target, { random: deterministicRand([0]) });
    expect(result.distractors).toHaveLength(3);
  });
});
