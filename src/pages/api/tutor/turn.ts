// One round-trip of the Azure-backed tutor:
//   audio (user speech, wav) + history → STT → Claude → TTS (SSML w/ voice
//   switching) → mp3 + transcripts.
//
// Returns audio/mpeg body; transcripts ride in headers
// (URL-encoded, since headers can't carry arbitrary unicode safely).

import type { APIRoute } from 'astro';
import { lexicon, type ScenarioId } from '../../../lib/lexicon';
import { SCENARIOS } from '../../../lib/scenarios';
import {
  buildAzureTutorSystemPrompt,
  buildSsml,
  pickTutorPhrases,
  type ChatTurn,
} from '../../../lib/tutor-conversation';
import { synthesizeFromSsml } from '../../../lib/azure-speech';

export const prerender = false;

type TurnRequestBody = {
  scenarioId: string;
  history: ChatTurn[]; // prior turns this session, NOT including the new user turn
  // For session bootstrapping: if `history` is empty AND `bootstrap=true`, we
  // skip STT and just generate Sveta's opening greeting. The audio blob is
  // not required in that case.
  bootstrap?: boolean;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const azureKey = getEnv(locals, 'AZURE_SPEECH_KEY');
  const azureRegion = getEnv(locals, 'AZURE_SPEECH_REGION');
  const anthropicKey = getEnv(locals, 'ANTHROPIC_API_KEY');

  if (!azureKey || !azureRegion) return jsonError('Azure Speech not configured', 503);
  if (!anthropicKey) return jsonError('Anthropic key not configured', 503);

  const fd = await request.formData();
  const audio = fd.get('audio');
  const meta = fd.get('meta');

  if (typeof meta !== 'string') return jsonError('missing meta', 400);
  let body: TurnRequestBody;
  try {
    body = JSON.parse(meta) as TurnRequestBody;
  } catch {
    return jsonError('invalid meta JSON', 400);
  }

  const scenarioId = body.scenarioId as ScenarioId;
  const knownScenarios = new Set(SCENARIOS.map((s) => s.id));
  if (!knownScenarios.has(scenarioId)) return jsonError(`unknown scenarioId ${scenarioId}`, 400);

  const phrases = pickTutorPhrases(lexicon, scenarioId, 8);
  const systemPrompt = buildAzureTutorSystemPrompt(scenarioId, phrases);

  // 1. STT (skip on bootstrap)
  let userTranscript = '';
  if (!body.bootstrap) {
    if (!(audio instanceof Blob) || audio.size === 0) {
      return jsonError('missing audio blob (or set bootstrap=true)', 400);
    }
    userTranscript = await azureRecognize(audio, azureKey, azureRegion).catch((err) => {
      console.warn(`[tutor/turn] STT failed: ${err}`);
      return '';
    });
  }

  // 2. Claude
  const messages: ChatTurn[] = [
    ...body.history,
    ...(userTranscript ? [{ role: 'user' as const, text: userTranscript }] : []),
  ];

  let tutorResponse = '';
  try {
    tutorResponse = await callClaude(systemPrompt, messages, anthropicKey, body.bootstrap === true);
  } catch (err) {
    return jsonError(`Claude call failed: ${err}`, 502);
  }

  if (!tutorResponse.trim()) {
    return jsonError('Claude returned empty response', 502);
  }

  // 3. TTS (SSML with voice-per-language span)
  const ssml = buildSsml(tutorResponse);
  let mp3: ArrayBuffer;
  try {
    mp3 = await synthesizeFromSsml(ssml, { key: azureKey, region: azureRegion });
  } catch (err) {
    return jsonError(`Azure TTS failed: ${err}`, 502);
  }

  return new Response(mp3, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
      'x-user-transcript': encodeURIComponent(userTranscript),
      'x-tutor-transcript': encodeURIComponent(tutorResponse),
      // CORS-expose the custom headers so the browser can read them
      'access-control-expose-headers': 'x-user-transcript, x-tutor-transcript',
    },
  });
};

// ── Azure STT (REST recognize) ────────────────────────────────────────────────
async function azureRecognize(audio: Blob, key: string, region: string): Promise<string> {
  // Auto-detect among ru-RU + en-US for code-switching support.
  // Reuses our existing PCM-wav input path (browser sends wav after blobToPcmWav).
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ru-RU&format=detailed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': pickAzureContentType(audio.type),
      Accept: 'application/json',
    },
    body: audio,
  });
  if (!res.ok) throw new Error(`Azure STT ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { DisplayText?: string; NBest?: Array<{ Display?: string }> };
  return data.NBest?.[0]?.Display ?? data.DisplayText ?? '';
}

function pickAzureContentType(mime: string): string {
  if (mime.includes('webm')) return 'audio/webm; codecs=opus';
  if (mime.includes('ogg')) return 'audio/ogg; codecs=opus';
  if (mime.includes('wav')) return 'audio/wav; codecs=audio/pcm; samplerate=16000';
  return 'audio/wav; codecs=audio/pcm; samplerate=16000';
}

// ── Claude (Anthropic Messages API) ───────────────────────────────────────────
async function callClaude(
  systemPrompt: string,
  messages: ChatTurn[],
  apiKey: string,
  bootstrap: boolean,
): Promise<string> {
  // For bootstrap, give Claude an empty user turn so it produces the opening
  // greeting per the system prompt's "OPENING" instruction.
  const userMessages = messages.length
    ? messages.map((m) => ({ role: m.role, content: m.text }))
    : [{ role: 'user' as const, content: bootstrap ? '(begin)' : '...' }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      // Tutor responses are short — 2-3 sentences. Cap aggressively.
      max_tokens: 200,
      temperature: 0.7,
      system: systemPrompt,
      messages: userMessages,
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((c) => c.type === 'text')?.text ?? '';
}

// ── helpers ───────────────────────────────────────────────────────────────────
function getEnv(locals: App.Locals | undefined, key: string): string | undefined {
  const fromProc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const fromRuntime = (
    locals as unknown as {
      runtime?: { env?: Record<string, string | undefined> };
    }
  )?.runtime?.env?.[key];
  return fromRuntime ?? fromProc;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
