import raw from '../data/lexicon.json';

export type ScenarioId =
  | 'approach-greet'
  | 'compliment-flirt'
  | 'romance-intimacy'
  | 'practical-errands'
  | 'confrontation-dominance'
  | 'reactions-filler'
  | 'numbers-time-money'
  | 'mat-color'
  | 'davai-versatile';

export type LexiconEntry = {
  id: string;
  en: string;
  ru: string;
  phonetic: string;
  category: string;
  tier: 1 | 2 | 3;
  scenario: ScenarioId;
  /**
   * Pimsleur teaching order within the entry's scenario. Lower = introduced
   * earlier. Two entries with the same seq fall back to id order. Items are
   * presented in this sequence on first introduction; SRS scheduling then
   * takes over for review.
   */
  seq: number;
  /** 1-based lesson number within the scenario. Derived from seq via lessonForSeq. */
  lesson: number;
  notes?: string;
  /**
   * Alternate transcripts Whisper may legitimately produce for a correct
   * pronunciation (colloquial/dialectal forms, common elisions). Any of
   * these counts as an exact match. `variants[*].ru` is auto-merged in at
   * load — don't duplicate.
   */
  accepts?: string[];
  /**
   * Equivalent phrases for different speakers/registers. Today: gendered
   * adjectives (e.g. "ты умная" / "ты умный"). Future: formal/plural address.
   * `label` is freeform display copy ("to a man", "formal"). Each variant's
   * `ru` is auto-spliced into `accepts` at load so grading passes for any form.
   */
  variants?: Array<{ ru: string; phonetic: string; label: string }>;
};

const _entries = raw as LexiconEntry[];
// Auto-merge variant Russian forms into accepts so grading passes regardless
// of which form the learner pronounces.
for (const e of _entries) {
  if (e.variants && e.variants.length) {
    const accepts = new Set(e.accepts ?? []);
    for (const v of e.variants) accepts.add(v.ru);
    e.accepts = Array.from(accepts);
  }
}

export const lexicon: LexiconEntry[] = _entries;

export function phoneticSyllables(phonetic: string): string[] {
  // Words split on space, syllables within a word split on hyphen.
  // Returned flat — callers usually want word-level indexing anyway.
  return phonetic.split(/\s+/).filter(Boolean);
}
