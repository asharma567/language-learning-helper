// Grading signature is a v1/v2 swap point.
// v1: Whisper transcript + fuzzy match (this file).
// v2: Azure Speech Pronunciation Assessment — replace implementation, keep GradeResult.

export type GradeResult = {
  score: number;
  exact: boolean;
  heard: string;
  target: string;
  wrongWordIndices: number[];
  confidence: number | null;
};

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[.,!?;:"'«»\-–—()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

// Needleman-Wunsch word alignment — returns target-word indices whose
// aligned heard word differs. Used to highlight the bad syllables.
export function diffWordIndices(target: string, heard: string): number[] {
  const t = normalize(target).split(' ').filter(Boolean);
  const h = normalize(heard).split(' ').filter(Boolean);

  const n = t.length;
  const m = h.length;
  const gap = -1;
  const match = 1;
  const mismatch = -1;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const back: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) {
    dp[i][0] = i * gap;
    back[i][0] = 1;
  }
  for (let j = 0; j <= m; j++) {
    dp[0][j] = j * gap;
    back[0][j] = 2;
  }
  back[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + (t[i - 1] === h[j - 1] ? match : mismatch);
      const up = dp[i - 1][j] + gap;
      const left = dp[i][j - 1] + gap;
      const best = Math.max(diag, up, left);
      dp[i][j] = best;
      back[i][j] = best === diag ? 0 : best === up ? 1 : 2;
    }
  }

  const wrong: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (step === 0) {
      if (t[i - 1] !== h[j - 1]) wrong.push(i - 1);
      i--;
      j--;
    } else if (step === 1) {
      wrong.push(i - 1);
      i--;
    } else {
      j--;
    }
  }
  return wrong.sort((a, b) => a - b);
}

// Returns true iff every word in `sub` appears in `full` in the same order
// (contiguous not required). Used to accept Whisper transcripts that pad the
// target with filler ("так что" when target is "что") without relaxing strict
// word-order discipline on multi-word phrases.
export function isWordSubsequence(sub: string, full: string): boolean {
  const subWords = normalize(sub).split(' ').filter(Boolean);
  const fullWords = normalize(full).split(' ').filter(Boolean);
  if (subWords.length === 0) return true;
  let i = 0;
  for (const w of fullWords) {
    if (w === subWords[i]) {
      i++;
      if (i === subWords.length) return true;
    }
  }
  return false;
}

export function gradeTranscript(
  targetRu: string,
  heardRu: string,
  confidence: number | null = null,
  accepts: string[] = [],
): GradeResult {
  const target = normalize(targetRu);
  const heard = normalize(heardRu);

  const variantMatch = accepts.some((v) => normalize(v) === heard);
  const targetInHeard = isWordSubsequence(target, heard);
  const variantInHeard = accepts.some((v) => isWordSubsequence(v, heard));

  const exact =
    target === heard || variantMatch || targetInHeard || variantInHeard;

  const score = exact ? 1 : similarity(target, heard);

  return {
    score,
    exact,
    heard,
    target,
    wrongWordIndices: exact ? [] : diffWordIndices(target, heard),
    confidence,
  };
}
