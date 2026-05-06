import { describe, expect, it } from 'vitest';
import {
  diffWordIndices,
  gradeTranscript,
  isWordSubsequence,
  levenshtein,
  normalize,
  similarity,
} from './grader';

describe('normalize', () => {
  it('lowercases', () => {
    expect(normalize('ПРИВЕТ')).toBe('привет');
  });
  it('collapses ё to е', () => {
    expect(normalize('всё')).toBe('все');
  });
  it('strips punctuation and collapses whitespace', () => {
    expect(normalize('Иди домой, сука!')).toBe('иди домой сука');
  });
  it('handles dashes and quotes', () => {
    expect(normalize('"иди-ка"')).toBe('иди ка');
  });
});

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
  it('counts single edits', () => {
    expect(levenshtein('кот', 'кит')).toBe(1);
    expect(levenshtein('abc', 'abcd')).toBe(1);
    expect(levenshtein('abcd', 'abc')).toBe(1);
  });
});

describe('similarity', () => {
  it('is 1 for exact match after normalize', () => {
    expect(similarity('Иди домой!', 'иди домой')).toBe(1);
  });
  it('is between 0 and 1 for partial match', () => {
    const s = similarity('иди домой сука', 'иди домой');
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.5);
  });
});

describe('diffWordIndices', () => {
  it('returns empty for identical strings', () => {
    expect(diffWordIndices('иди домой', 'иди домой')).toEqual([]);
  });
  it('flags the word that was wrong', () => {
    expect(diffWordIndices('иди домой сука', 'иди домой сюда')).toEqual([2]);
  });
  it('flags missing words as wrong in the target', () => {
    expect(diffWordIndices('иди домой сука', 'иди домой')).toEqual([2]);
  });
});

describe('isWordSubsequence', () => {
  it('matches identical strings', () => {
    expect(isWordSubsequence('иди домой', 'иди домой')).toBe(true);
  });
  it('matches when heard pads the target with extra words', () => {
    expect(isWordSubsequence('что', 'так что')).toBe(true);
    expect(isWordSubsequence('что', 'что, что')).toBe(true);
    expect(isWordSubsequence('иди домой', 'ну иди же домой')).toBe(true);
  });
  it('requires original word order', () => {
    expect(isWordSubsequence('иди домой', 'домой иди')).toBe(false);
  });
  it('rejects when a target word is missing', () => {
    expect(isWordSubsequence('иди домой сука', 'иди сука')).toBe(false);
  });
});

describe('gradeTranscript', () => {
  it('reports exact=true when transcript matches', () => {
    const g = gradeTranscript('Иди домой', 'иди домой');
    expect(g.exact).toBe(true);
    expect(g.score).toBe(1);
    expect(g.wrongWordIndices).toEqual([]);
  });
  it('populates wrongWordIndices on mismatch', () => {
    const g = gradeTranscript('иди домой сука', 'иди домой сюда');
    expect(g.exact).toBe(false);
    expect(g.wrongWordIndices).toEqual([2]);
  });
  it('passes confidence through', () => {
    const g = gradeTranscript('да', 'да', 0.87);
    expect(g.confidence).toBe(0.87);
  });
  it('accepts padded single-word transcripts as exact', () => {
    const g = gradeTranscript('что', 'так что');
    expect(g.exact).toBe(true);
    expect(g.score).toBe(1);
  });
  it('accepts variant transcripts as exact when supplied', () => {
    const g = gradeTranscript('что', 'чё', null, ['чё', 'шо']);
    expect(g.exact).toBe(true);
    expect(g.score).toBe(1);
  });
  it('accepts variant embedded in a longer heard transcript', () => {
    const g = gradeTranscript('сейчас', 'ну щас иду', null, ['щас']);
    expect(g.exact).toBe(true);
  });
  it('still fails when words are reordered', () => {
    const g = gradeTranscript('иди домой', 'домой иди');
    expect(g.exact).toBe(false);
  });
  it('still fails when target word missing', () => {
    const g = gradeTranscript('иди домой сука', 'иди сука');
    expect(g.exact).toBe(false);
  });
});
