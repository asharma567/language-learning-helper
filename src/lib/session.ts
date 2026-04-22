import {
  grade,
  newItem,
  pickSessionQueue,
  type ItemState,
} from './srs';
import type { LexiconEntry } from './lexicon';
import { loadProgress, saveProgress, type Progress } from './storage';

export type SessionItem = {
  entry: LexiconEntry;
  state: ItemState;
  isNew: boolean;
};

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
  }

  buildQueue(newPerSession = 5): SessionItem[] {
    const orderedIds = [...this.lexiconById.keys()].sort((a, b) => {
      const ta = this.lexiconById.get(a)?.tier ?? 9;
      const tb = this.lexiconById.get(b)?.tier ?? 9;
      return ta - tb;
    });
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
    saveProgress(this.progress);
    return next;
  }

  getProgress(): Progress {
    return this.progress;
  }
}
