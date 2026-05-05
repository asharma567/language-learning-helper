// Anthropic Claude (haiku-4.5) translation provider (server-side).
// Used as the automatic fallback when OpenAI is unavailable.

import { SYSTEM_PROMPT, type TranslationResult } from './types';
import { ProviderError } from './openai';

export type AnthropicUsage = { input_tokens: number; output_tokens: number };

export type AnthropicResult = {
  result: TranslationResult;
  usage: AnthropicUsage;
};

const MODEL = 'claude-haiku-4-5-20251001';

export async function translateWithAnthropic(
  en: string,
  apiKey: string,
): Promise<AnthropicResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      // Typical output ~60-90 tokens. 128 gives 2× headroom and bounds
      // worst case if Claude wanders. (Anthropic's prompt cache minimum
      // is 2048 tokens for Haiku — our ~165-token system prompt is below
      // that threshold, so we don't enable cache_control.)
      max_tokens: 128,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: en }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ProviderError('anthropic', res.status, detail);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: AnthropicUsage;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new ProviderError('anthropic', 502, 'no text content');

  // Strip markdown fences defensively (Claude sometimes wraps JSON in ```).
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: TranslationResult;
  try {
    parsed = JSON.parse(stripped) as TranslationResult;
  } catch {
    throw new ProviderError('anthropic', 502, `non-JSON completion: ${stripped.slice(0, 200)}`);
  }
  if (!parsed.ru || !parsed.phonetic) {
    throw new ProviderError('anthropic', 502, `missing ru or phonetic: ${stripped.slice(0, 200)}`);
  }

  return {
    result: parsed,
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}
