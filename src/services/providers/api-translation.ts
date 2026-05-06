// Client wrapper around the server-side `/api/translate-phrase` orchestrator.
// The orchestrator picks OpenAI first and falls back to Anthropic — the
// chosen provider is reported back in the response's `provider` field.

import type { TranslationProvider, TranslationResult } from '../translation';

export const apiTranslation: TranslationProvider = {
  async translate(en) {
    const res = await fetch('/api/translate-phrase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ en }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`translate-phrase ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as TranslationResult;
  },
};
