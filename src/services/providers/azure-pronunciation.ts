// Azure Pronunciation Assessment provider.
// Converts the recorder's webm/opus blob to PCM wav (Azure PA only scores PCM),
// posts to /api/azure-pronounce, returns the rich assessment.

import { blobToPcmWav } from '../audio-convert';
// (path: src/services/audio-convert.ts — co-located with the providers that use it)
import type { PronunciationAssessment, PronunciationProvider } from '../pronunciation';

export const azurePronunciation: PronunciationProvider = {
  async assess(audio, referenceText) {
    const wav = await blobToPcmWav(audio);
    const fd = new FormData();
    fd.append('audio', wav, 'attempt.wav');
    fd.append('referenceText', referenceText);
    const res = await fetch('/api/azure-pronounce', { method: 'POST', body: fd });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`azure-pronounce ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as PronunciationAssessment;
  },
};
