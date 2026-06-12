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
  stripMarkdownForTts,
  type ChatTurn,
} from '../../../lib/tutor-conversation';
import { synthesizeFromSsml } from '../../../lib/azure-speech';
import { synthesizeWithOpenAI, transcribeWithOpenAI } from '../../../lib/openai-audio';

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
  const openaiKey = getEnv(locals, 'OPENAI_API_KEY');
  const azureCreds = azureKey && azureRegion ? { key: azureKey, region: azureRegion } : undefined;

  if (!azureCreds && !openaiKey) return jsonError('no speech provider configured', 503);
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
    userTranscript = await recognizeSpeech(audio, azureCreds, openaiKey).catch((err) => {
      console.warn(`[tutor/turn] STT failed: ${String(err)}`);
      return '';
    });
  }

  // 2. Pick a tutor reply.
  //
  // If STT returned nothing on a non-bootstrap turn, skip Claude entirely:
  // - Anthropic requires alternating roles ending on user; sending an empty
  //   user message after a previous assistant turn yields "empty response"
  //   500s and bad UX.
  // - The right behavior is "Sorry, didn't catch that, try again?" — that's
  //   a deterministic reply; no LLM round-trip needed.
  let tutorResponse = '';
  if (!body.bootstrap && !userTranscript.trim()) {
    tutorResponse = pickRetryPrompt(body.history.length);
  } else {
    const messages: ChatTurn[] = [
      ...body.history,
      ...(userTranscript ? [{ role: 'user' as const, text: userTranscript }] : []),
    ];
    try {
      tutorResponse = await callClaude(systemPrompt, messages, anthropicKey, body.bootstrap === true);
    } catch (err) {
      return jsonError(`Claude call failed: ${err}`, 502);
    }
    if (!tutorResponse.trim()) {
      // Fallback rather than 502 — keeps the conversation alive.
      tutorResponse = "Hmm, I lost my train of thought. What were you saying?";
    }
  }

  // 3. TTS (SSML with voice-per-language span when Azure is available)
  let mp3: ArrayBuffer;
  try {
    mp3 = await synthesizeTutorResponse(tutorResponse, azureCreds, openaiKey);
  } catch (err) {
    return jsonError(`TTS failed: ${err}`, 502);
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
//
// The learner speaks BOTH Russian (drilling phrases) AND English (asking
// questions, chatting). Azure's `cognitiveservices/v1` recognize endpoint
// only accepts a single `language=` per request, so we fire the audio at
// both ru-RU and en-US in parallel and pick the higher-confidence transcript.
// Cost: ~$0.0001 extra per turn. Worth it — single-language recognition
// returned garbage when the user spoke the "other" language.
async function azureRecognize(audio: Blob, key: string, region: string): Promise<string> {
  const ab = await audio.arrayBuffer();
  const contentType = pickAzureContentType(audio.type);
  const recognize = async (lang: string) => {
    const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}&format=detailed`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body: ab.slice(0),
    });
    if (!res.ok) return { text: '', confidence: 0 };
    const data = (await res.json().catch(() => ({}))) as {
      DisplayText?: string;
      NBest?: Array<{ Display?: string; Confidence?: number }>;
      RecognitionStatus?: string;
    };
    if (data.RecognitionStatus && data.RecognitionStatus !== 'Success') {
      return { text: '', confidence: 0 };
    }
    const best = data.NBest?.[0];
    return {
      text: best?.Display ?? data.DisplayText ?? '',
      confidence: best?.Confidence ?? 0,
    };
  };
  // [autoresearch H3] Sequential ru-RU first; fall back to en-US only if
  // Russian came back empty OR low confidence. Saves ~one Azure round trip
  // on the common case (learner drilling Russian phrases).
  const ru = await recognize('ru-RU');
  if (ru.text && ru.confidence >= 0.6) return ru.text;
  const en = await recognize('en-US');
  if (en.text) return en.text;
  return ru.text; // best-effort fallback
}

async function recognizeSpeech(
  audio: Blob,
  azureCreds: { key: string; region: string } | undefined,
  openaiKey: string | undefined,
): Promise<string> {
  if (azureCreds) {
    try {
      const transcript = await azureRecognize(audio, azureCreds.key, azureCreds.region);
      if (transcript.trim() || !openaiKey) return transcript;
    } catch (err) {
      if (!openaiKey) throw err;
      console.warn(`[tutor/turn] Azure STT failed, falling back to OpenAI: ${String(err)}`);
    }
  }
  if (!openaiKey) return '';
  return transcribeWithOpenAI(audio, openaiKey, {
    prompt: 'The speaker may use Russian and English while practicing Russian phrases with a tutor.',
  });
}

async function synthesizeTutorResponse(
  tutorResponse: string,
  azureCreds: { key: string; region: string } | undefined,
  openaiKey: string | undefined,
): Promise<ArrayBuffer> {
  if (azureCreds) {
    try {
      return await synthesizeFromSsml(buildSsml(tutorResponse), azureCreds);
    } catch (err) {
      if (!openaiKey) throw err;
      console.warn(`[tutor/turn] Azure TTS failed, falling back to OpenAI: ${String(err)}`);
    }
  }
  if (!openaiKey) throw new Error('no TTS provider available');
  return synthesizeWithOpenAI(stripMarkdownForTts(tutorResponse), openaiKey);
}

function pickAzureContentType(mime: string): string {
  if (mime.includes('webm')) return 'audio/webm; codecs=opus';
  if (mime.includes('ogg')) return 'audio/ogg; codecs=opus';
  if (mime.includes('wav')) return 'audio/wav; codecs=audio/pcm; samplerate=16000';
  return 'audio/wav; codecs=audio/pcm; samplerate=16000';
}

// Rotating short prompts when STT heard nothing — keeps the conversation
// alive without burning a Claude call. Index varies by history length so
// the same line doesn't repeat back-to-back when the mic stays silent.
const RETRY_PROMPTS = [
  "Sorry, I didn't catch that — try again?",
  "Hmm, didn't hear you. One more time?",
  "Couldn't make that out. Could you say it again?",
  "I missed it — repeat?",
];
function pickRetryPrompt(historyLen: number): string {
  return RETRY_PROMPTS[historyLen % RETRY_PROMPTS.length];
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
      // [autoresearch H1] Try Haiku for speed.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
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
