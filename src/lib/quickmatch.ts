import type { LexiconEntry } from './lexicon';

export type QuickMatchSet = {
  target: LexiconEntry;
  distractors: [LexiconEntry, LexiconEntry, LexiconEntry];
};

export type QuickMatchOpts = {
  /** Seeded random function returning [0, 1) — defaults to Math.random */
  random?: () => number;
};

/**
 * Picks 3 distractors for a target item from the given lexicon.
 *
 * Preference order:
 *   1. Same scenario as target (excluding target itself)
 *   2. Same category as target (excluding target and already-picked)
 *   3. Anything else (excluding target and already-picked)
 *
 * Distractors are unique and never equal to target (by id).
 */
export function pickQuickMatchSet(
  lexicon: LexiconEntry[],
  target: LexiconEntry,
  opts: QuickMatchOpts = {},
): QuickMatchSet {
  const rand = opts.random ?? Math.random;

  const others = lexicon.filter((e) => e.id !== target.id);

  const sameScenario = shuffle(
    others.filter((e) => e.scenario === target.scenario),
    rand,
  );
  const sameCategory = shuffle(
    others.filter(
      (e) => e.category === target.category && e.scenario !== target.scenario,
    ),
    rand,
  );
  const fallback = shuffle(
    others.filter(
      (e) =>
        e.scenario !== target.scenario && e.category !== target.category,
    ),
    rand,
  );

  const pool = [...sameScenario, ...sameCategory, ...fallback];

  if (pool.length < 3) {
    throw new Error(
      `Not enough entries to pick 3 distractors for target "${target.id}" (lexicon has ${lexicon.length} entries, ${pool.length} available)`,
    );
  }

  const picked = new Set<string>();
  const distractors: LexiconEntry[] = [];

  for (const candidate of pool) {
    if (distractors.length === 3) break;
    if (picked.has(candidate.id)) continue;
    picked.add(candidate.id);
    distractors.push(candidate);
  }

  return {
    target,
    distractors: distractors as [LexiconEntry, LexiconEntry, LexiconEntry],
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
