// OpenAI gpt-4o-mini translation provider (server-side).

import { SYSTEM_PROMPT, type TranslationResult } from './types';

export type OpenAIUsage = { prompt_tokens: number; completion_tokens: number };

export type OpenAIResult = {
  result: TranslationResult;
  usage: OpenAIUsage;
};

export async function translateWithOpenAI(
  en: string,
  apiKey: string,
): Promise<OpenAIResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: en },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ProviderError('openai', res.status, detail);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenAIUsage;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new ProviderError('openai', 502, 'no completion content');

  let parsed: TranslationResult;
  try {
    parsed = JSON.parse(raw) as TranslationResult;
  } catch {
    throw new ProviderError('openai', 502, `non-JSON completion: ${raw.slice(0, 200)}`);
  }
  if (!parsed.ru || !parsed.phonetic) {
    throw new ProviderError('openai', 502, `missing ru or phonetic: ${raw.slice(0, 200)}`);
  }

  return {
    result: parsed,
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  };
}

export class ProviderError extends Error {
  constructor(
    public provider: 'openai' | 'anthropic',
    public status: number,
    public detail: string,
  ) {
    super(`${provider} ${status}: ${detail}`);
  }
}
