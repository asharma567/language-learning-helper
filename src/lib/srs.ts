export const PIMSLEUR_INTERVALS_SECONDS = [
  5,
  25,
  120,
  600,
  3_600,
  18_000,
  86_400,
  432_000,
  2_160_000,
] as const;

export const MAX_LEVEL = PIMSLEUR_INTERVALS_SECONDS.length - 1;

export type ItemId = string;

export type ItemState = {
  id: ItemId;
  level: number;
  dueAt: number;
  consecutiveCorrect: number;
  lastScore: number | null;
  introduced: boolean;
};

export function newItem(id: ItemId, now: number = Date.now()): ItemState {
  return {
    id,
    level: 0,
    dueAt: now,
    consecutiveCorrect: 0,
    lastScore: null,
    introduced: false,
  };
}

export type GradeOutcome = 'advance' | 'hold' | 'demote';

export function outcomeFromScore(score: number): GradeOutcome {
  if (score >= 1) return 'advance';
  if (score >= 0.9) return 'hold';
  return 'demote';
}

export function grade(
  item: ItemState,
  score: number,
  now: number = Date.now(),
): ItemState {
  const outcome = outcomeFromScore(score);
  let level = item.level;
  let consecutiveCorrect = item.consecutiveCorrect;
  let dueAt: number;

  if (outcome === 'advance') {
    level = Math.min(item.level + 1, MAX_LEVEL);
    consecutiveCorrect = item.consecutiveCorrect + 1;
    dueAt = now + PIMSLEUR_INTERVALS_SECONDS[level] * 1000;
  } else if (outcome === 'hold') {
    consecutiveCorrect = 0;
    const holdSeconds = Math.max(
      PIMSLEUR_INTERVALS_SECONDS[Math.max(level - 1, 0)],
      5,
    );
    dueAt = now + holdSeconds * 1000;
  } else {
    level = Math.max(item.level - 1, 0);
    consecutiveCorrect = 0;
    dueAt = now + 30 * 1000;
  }

  return {
    ...item,
    level,
    dueAt,
    consecutiveCorrect,
    lastScore: score,
    introduced: true,
  };
}

export type SessionPickOptions = {
  newPerSession?: number;
  now?: number;
};

export function pickSessionQueue(
  items: ItemState[],
  allIds: ItemId[],
  opts: SessionPickOptions = {},
): ItemId[] {
  const now = opts.now ?? Date.now();
  const newPerSession = opts.newPerSession ?? 5;

  const byId = new Map(items.map((i) => [i.id, i] as const));
  const due = items
    .filter((i) => i.introduced && i.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((i) => i.id);

  const newIds = allIds
    .filter((id) => !byId.get(id)?.introduced)
    .slice(0, newPerSession);

  return [...due, ...newIds];
}
