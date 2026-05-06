// Pronunciation service — single entrypoint for components.
//
// Components hand in a recorded blob + reference text and get back a rich
// PronunciationAssessment (overall + per-word + per-phoneme scores). The
// score-to-SRS mapping (advance/hold/demote) lives in `lib/grader.ts`'s
// gradeFromAzure() and is provider-agnostic so any future provider that
// produces the same shape just slots in.

import { azurePronunciation } from './providers/azure-pronunciation';

export type PhonemeScore = { phoneme: string; accuracy: number };

export type WordScore = {
  word: string;
  accuracy: number;
  errorType: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | string;
  phonemes: PhonemeScore[];
};

export type PronunciationAssessment = {
  recognizedText: string;
  pronScore: number;       // 0–100 overall pronunciation
  accuracy: number;        // 0–100
  fluency: number;         // 0–100
  completeness: number;    // 0–100
  prosody: number | null;  // 0–100, null if provider doesn't return it
  words: WordScore[];
};

export interface PronunciationProvider {
  assess(audio: Blob, referenceText: string): Promise<PronunciationAssessment>;
}

const PROVIDERS = {
  azure: azurePronunciation,
} as const;

let active: PronunciationProvider = PROVIDERS.azure;

export function setPronunciationProvider(name: keyof typeof PROVIDERS): void {
  active = PROVIDERS[name];
}

export function getPronunciationProvider(): PronunciationProvider {
  return active;
}

export const assessPronunciation = (audio: Blob, referenceText: string) =>
  active.assess(audio, referenceText);
