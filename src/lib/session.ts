import {
  grade,
  isMastered,
  newItem,
  pickSessionQueue,
  type ItemState,
} from './srs';
import type { LexiconEntry, ScenarioId } from './lexicon';
import { entriesInScenario, getScenario, SCENARIOS } from './scenarios';
import { loadProgress, saveProgress, type Progress } from './storage';
import { lessonForSeq } from './lessons';

export const DEFAULT_NEW_PER_SESSION = 12;

export type SessionItem = {
  entry: LexiconEntry;
  state: ItemState;
  isNew: boolean;
};

export type LessonStats = {
  lesson: number;
  total: number;
  introduced: number;
  mastered: number;
  due: number;
};

export type ScenarioStats = {
  scenarioId: ScenarioId;
  title: string;
  total: number;
  introduced: number;
  mastered: number;
  due: number;
  perLesson: LessonStats[];
};

export type GlobalStats = {
  totalEntries: number;
  introduced: number;
  mastered: number;
  streak: number;
  totalAttempts: number;
  perCategory: Array<{
    category: string;
    total: number;
    introduced: number;
    mastered: number;
  }>;
  perScenario: ScenarioStats[];
};

export function dayKey(now: number = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nextStreak(
  prev: Progress['streak'],
  today: string,
): Progress['streak'] {
  if (prev.lastSessionDay === today) return prev;
  if (prev.lastSessionDay === null) {
    return { lastSessionDay: today, count: 1 };
  }
  const prevDate = new Date(prev.lastSessionDay + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const diffDays = Math.round(
    (todayDate.getTime() - prevDate.getTime()) / 86_400_000,
  );
  if (diffDays === 1) {
    return { lastSessionDay: today, count: prev.count + 1 };
  }
  return { lastSessionDay: today, count: 1 };
}

// Sort comparator: scenario teaching order first, then per-scenario seq.
function byScenarioOrderThenSeq(a: LexiconEntry, b: LexiconEntry): number {
  const sa = getScenario(a.scenario).order;
  const sb = getScenario(b.scenario).order;
  if (sa !== sb) return sa - sb;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id.localeCompare(b.id);
}

export class SessionManager {
  private progress: Progress;
  private lexiconById: Map<string, LexiconEntry>;

  constructor(lexicon: LexiconEntry[]) {
    this.lexiconById = new Map(lexicon.map((e) => [e.id, e]));
    this.progress = loadProgress();
    this.ensureStates(lexicon);
  }

  private ensureStates(lexicon: LexiconEntry[]): void {
    const seen = new Set(this.progress.items.map((i) => i.id));
    for (const entry of lexicon) {
      if (!seen.has(entry.id)) {
        this.progress.items.push(newItem(entry.id));
      }
    }
    // Drop stale items whose lexicon entry no longer exists.
    this.progress.items = this.progress.items.filter((i) =>
      this.lexiconById.has(i.id),
    );
  }

  buildQueue(newPerSession = DEFAULT_NEW_PER_SESSION): SessionItem[] {
    const orderedIds = [...this.lexiconById.values()]
      .slice()
      .sort(byScenarioOrderThenSeq)
      .map((e) => e.id);
    const queueIds = pickSessionQueue(this.progress.items, orderedIds, {
      newPerSession,
    });
    const stateById = new Map(this.progress.items.map((i) => [i.id, i]));
    return queueIds.flatMap((id) => {
      const entry = this.lexiconById.get(id);
      const state = stateById.get(id);
      if (!entry || !state) return [];
      return [{ entry, state, isNew: !state.introduced }];
    });
  }

  buildScenarioQueue(
    scenarioId: ScenarioId,
    newPerSession = DEFAULT_NEW_PER_SESSION,
  ): SessionItem[] {
    const scenarioEntries = entriesInScenario(
      [...this.lexiconById.values()],
      scenarioId,
    );
    const orderedIds = scenarioEntries
      .slice()
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
      .map((e) => e.id);
    const queueIds = pickSessionQueue(this.progress.items, orderedIds, {
      newPerSession,
    });
    const stateById = new Map(this.progress.items.map((i) => [i.id, i]));
    return queueIds.flatMap((id) => {
      const entry = this.lexiconById.get(id);
      const state = stateById.get(id);
      if (!entry || !state) return [];
      return [{ entry, state, isNew: !state.introduced }];
    });
  }

  buildLessonQueue(
    scenarioId: ScenarioId,
    lessonNumber: number,
    newPerSession = DEFAULT_NEW_PER_SESSION,
  ): SessionItem[] {
    const lessonEntries = [...this.lexiconById.values()].filter(
      (e) => e.scenario === scenarioId && e.lesson === lessonNumber,
    );
    const orderedIds = lessonEntries
      .slice()
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
      .map((e) => e.id);
    const queueIds = pickSessionQueue(this.progress.items, orderedIds, {
      newPerSession,
    });
    const stateById = new Map(this.progress.items.map((i) => [i.id, i]));
    return queueIds.flatMap((id) => {
      const entry = this.lexiconById.get(id);
      const state = stateById.get(id);
      if (!entry || !state) return [];
      return [{ entry, state, isNew: !state.introduced }];
    });
  }

  recordAttempt(id: string, score: number): ItemState {
    const idx = this.progress.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`unknown item ${id}`);
    const prev = this.progress.items[idx];
    const next = grade(prev, score);
    this.progress.items[idx] = next;
    this.progress.stats.totalAttempts += 1;
    if (score === 1) this.progress.stats.totalAdvances += 1;
    this.progress.streak = nextStreak(this.progress.streak, dayKey());
    saveProgress(this.progress);
    return next;
  }

  getStats(): GlobalStats {
    const items = this.progress.items;
    const introduced = items.filter((i) => i.introduced).length;
    const mastered = items.filter((i) => isMastered(i)).length;

    const catCounts = new Map<
      string,
      { total: number; introduced: number; mastered: number }
    >();
    for (const entry of this.lexiconById.values()) {
      const c = catCounts.get(entry.category) ?? {
        total: 0,
        introduced: 0,
        mastered: 0,
      };
      c.total += 1;
      catCounts.set(entry.category, c);
    }
    const stateById = new Map(items.map((i) => [i.id, i]));
    for (const entry of this.lexiconById.values()) {
      const s = stateById.get(entry.id);
      if (!s) continue;
      const c = catCounts.get(entry.category)!;
      if (s.introduced) c.introduced += 1;
      if (isMastered(s)) c.mastered += 1;
    }

    const now = Date.now();
    const perScenario: ScenarioStats[] = SCENARIOS.map((scenario) => {
      const scenarioEntries = [...this.lexiconById.values()].filter(
        (e) => e.scenario === scenario.id,
      );
      let scenarioIntroduced = 0;
      let scenarioMastered = 0;
      let scenarioDue = 0;

      // Build per-lesson buckets
      const lessonMap = new Map<number, { total: number; introduced: number; mastered: number; due: number }>();
      for (const entry of scenarioEntries) {
        const ln = entry.lesson ?? lessonForSeq(entry.seq);
        if (!lessonMap.has(ln)) lessonMap.set(ln, { total: 0, introduced: 0, mastered: 0, due: 0 });
        const bucket = lessonMap.get(ln)!;
        bucket.total += 1;
        const s = stateById.get(entry.id);
        if (s?.introduced) {
          scenarioIntroduced += 1;
          bucket.introduced += 1;
          if (isMastered(s)) { scenarioMastered += 1; bucket.mastered += 1; }
          if (s.dueAt <= now) { scenarioDue += 1; bucket.due += 1; }
        }
      }

      const perLesson: LessonStats[] = [...lessonMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([lesson, counts]) => ({ lesson, ...counts }));

      return {
        scenarioId: scenario.id,
        title: scenario.title,
        total: scenarioEntries.length,
        introduced: scenarioIntroduced,
        mastered: scenarioMastered,
        due: scenarioDue,
        perLesson,
      };
    });

    return {
      totalEntries: this.lexiconById.size,
      introduced,
      mastered,
      streak: this.progress.streak.count,
      totalAttempts: this.progress.stats.totalAttempts,
      perCategory: [...catCounts.entries()]
        .map(([category, c]) => ({ category, ...c }))
        .sort((a, b) => b.total - a.total),
      perScenario,
    };
  }

  getProgress(): Progress {
    return this.progress;
  }
}
