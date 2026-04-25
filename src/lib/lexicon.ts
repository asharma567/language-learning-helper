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
  notes?: string;
  /**
   * Alternate transcripts Whisper may legitimately produce for a correct
   * pronunciation (colloquial/dialectal forms, common elisions). Any of
   * these counts as an exact match.
   */
  accepts?: string[];
};

export const lexicon: LexiconEntry[] = raw as LexiconEntry[];

export function phoneticSyllables(phonetic: string): string[] {
  // Words split on space, syllables within a word split on hyphen.
  // Returned flat — callers usually want word-level indexing anyway.
  return phonetic.split(/\s+/).filter(Boolean);
}
