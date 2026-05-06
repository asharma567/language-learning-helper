// Mints an ephemeral OpenAI Realtime session. The browser uses the returned
// client_secret to open a direct WebRTC connection to OpenAI — server is NOT
// in the audio path.
//
// Server responsibilities:
//   1. Read scenarioId from request body
//   2. Pick 8 entries from that scenario's lexicon
//   3. Build the tutor system prompt
//   4. POST to OpenAI realtime sessions API with that prompt + voice + VAD config
//   5. Return { client_secret, model, voice, scenario, scenario_title } to client

import type { APIRoute } from 'astro';
import { lexicon, type ScenarioId } from '../../../lib/lexicon';
import { getScenario, SCENARIOS } from '../../../lib/scenarios';
import { buildTutorPrompt, pickTutorPhrases } from '../../../lib/realtime-prompt';

export const prerender = false;

const REALTIME_MODEL = 'gpt-realtime';
const REALTIME_VOICE = 'marin';
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = getEnv(locals, 'OPENAI_API_KEY');
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY not configured' }, 503);
  }

  let body: { scenarioId?: string };
  try {
    body = (await request.json()) as { scenarioId?: string };
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const scenarioId = (body.scenarioId ?? 'approach-greet') as ScenarioId;
  const knownScenarioIds = new Set(SCENARIOS.map((s) => s.id));
  if (!knownScenarioIds.has(scenarioId)) {
    return json({ error: `unknown scenarioId: ${scenarioId}` }, 400);
  }

  const scenario = getScenario(scenarioId);
  const entries = pickTutorPhrases(lexicon, scenarioId, 8);
  if (entries.length === 0) {
    return json({ error: `scenario ${scenarioId} has no entries` }, 500);
  }
  const instructions = buildTutorPrompt({ scenarioId, entries });

  // Mint ephemeral session via OpenAI Realtime API.
  // Endpoint: POST /v1/realtime/client_secrets (current GA shape)
  // Returns a short-lived client_secret the browser uses to open the WebRTC call.
  const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions,
        audio: {
          output: {
            voice: REALTIME_VOICE,
          },
          input: {
            transcription: {
              model: TRANSCRIBE_MODEL,
              // language: null = let the model auto-detect (allows EN ↔ RU mid-turn)
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              // 700ms — shorter than 0racle's tuned 1500ms because language
              // learners pause to think but we want responsive feedback.
              silence_duration_ms: 700,
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[realtime/session] OpenAI mint failed: ${upstream.status} ${detail.slice(0, 300)}`);
    return json(
      {
        error: 'failed to mint realtime session',
        upstream_status: upstream.status,
        upstream_detail: detail.slice(0, 1000),
      },
      502,
    );
  }

  const data = (await upstream.json()) as {
    value?: string;
    expires_at?: number;
    session?: { id?: string };
  };

  // The new client_secrets endpoint returns the secret as `value` at the top
  // level. Older `sessions` endpoint nested it under `client_secret`. Be
  // defensive in case the API shape evolves.
  const clientSecret =
    data.value ??
    (data as unknown as { client_secret?: { value?: string } }).client_secret?.value;
  const expiresAt =
    data.expires_at ??
    (data as unknown as { client_secret?: { expires_at?: number } }).client_secret?.expires_at;

  if (!clientSecret) {
    return json(
      { error: 'realtime mint returned no client_secret', raw: data },
      502,
    );
  }

  return json({
    client_secret: clientSecret,
    expires_at: expiresAt,
    model: REALTIME_MODEL,
    voice: REALTIME_VOICE,
    scenario_id: scenarioId,
    scenario_title: scenario.title,
    phrase_count: entries.length,
  });
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
