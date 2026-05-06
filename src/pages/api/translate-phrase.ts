// Translation orchestrator: try OpenAI first, fall back to Anthropic.
// Returns the rich result + a `provider` field so the client knows which
// LLM answered. On total failure, returns 503 with structured per-provider
// detail so future "what's the holdup?" moments are self-diagnosing.

import type { APIRoute } from 'astro';
import { translateWithOpenAI, ProviderError } from '../../lib/translation/openai';
import { translateWithAnthropic } from '../../lib/translation/anthropic';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const openaiKey = getEnv(locals, 'OPENAI_API_KEY');
  const anthropicKey = getEnv(locals, 'ANTHROPIC_API_KEY');

  if (!openaiKey && !anthropicKey) {
    return json(
      { error: 'no LLM provider configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY)' },
      503,
    );
  }

  let body: { en?: string };
  try {
    body = (await request.json()) as { en?: string };
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const en = (body.en ?? '').trim();
  if (!en) return json({ error: 'missing en' }, 400);
  if (en.length > 200) return json({ error: 'phrase too long (max 200 chars)' }, 400);

  const errors: { openai?: { status: number; detail: string }; anthropic?: { status: number; detail: string } } = {};

  if (openaiKey) {
    try {
      const { result, usage } = await translateWithOpenAI(en, openaiKey);
      return json({ ...result, provider: 'openai', usage });
    } catch (err) {
      const pe = asProviderError(err, 'openai');
      errors.openai = { status: pe.status, detail: pe.detail };
      console.warn(`[translate] openai failed: ${pe.status} ${pe.detail.slice(0, 200)}`);
    }
  }

  if (anthropicKey) {
    try {
      const { result, usage } = await translateWithAnthropic(en, anthropicKey);
      return json({ ...result, provider: 'anthropic', usage });
    } catch (err) {
      const pe = asProviderError(err, 'anthropic');
      errors.anthropic = { status: pe.status, detail: pe.detail };
      console.warn(`[translate] anthropic failed: ${pe.status} ${pe.detail.slice(0, 200)}`);
    }
  }

  return json(
    { error: 'all configured providers failed', ...errors },
    503,
  );
};

function getEnv(locals: App.Locals | undefined, key: string): string | undefined {
  const fromProc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const fromRuntime = (
    locals as unknown as {
      runtime?: { env?: Record<string, string | undefined> };
    }
  )?.runtime?.env?.[key];
  return fromRuntime ?? fromProc;
}

function asProviderError(err: unknown, provider: 'openai' | 'anthropic'): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(provider, 0, err instanceof Error ? err.message : String(err));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
