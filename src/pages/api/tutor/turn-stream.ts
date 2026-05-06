// Streaming variant of /api/tutor/turn.
//
// Same STT and Claude system prompt, but:
//   - Claude response is streamed token-by-token
//   - As soon as a sentence boundary lands, we send that sentence to Azure TTS
//   - The mp3 chunk is emitted to the client as a JSON-lines event
//   - Client plays each chunk as it arrives (vs waiting for full response)
//
// Wire format: NDJSON over a streaming HTTP response.
//   {"type":"user_transcript","text":"..."}
//   {"type":"audio_chunk","sentence":"...","audio_b64":"...","seq":0}
//   {"type":"audio_chunk","sentence":"...","audio_b64":"...","seq":1}
//   {"type":"done","tutor_full":"..."}
//
// Time-to-first-audio drops because the user hears the first sentence while
// Claude is still generating the second.

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
  history: ChatTurn[];
  bootstrap?: boolean;
};

const RETRY_PROMPTS = [
  "Sorry, I didn't catch that — try again?",
  "Hmm, didn't hear you. One more time?",
  "Couldn't make that out. Could you say it again?",
  "I missed it — repeat?",
];

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
  try { body = JSON.parse(meta) as TurnRequestBody; } catch { return jsonError('invalid meta JSON', 400); }
  const scenarioId = body.scenarioId as ScenarioId;
  if (!new Set(SCENARIOS.map((s) => s.id)).has(scenarioId)) return jsonError('unknown scenarioId', 400);

  const phrases = pickTutorPhrases(lexicon, scenarioId, 8);
  const systemPrompt = buildAzureTutorSystemPrompt(scenarioId, phrases);

  // [V1] Validate audio shape SYNCHRONOUSLY before opening the stream
  if (!body.bootstrap && (!(audio instanceof Blob) || audio.size === 0)) {
    return jsonError('missing audio', 400);
  }

  // [V1] Optimistic filler — pre-fetch so first chunk fires instantly
  // when the stream opens. Cycles among 5 short acknowledgments to avoid
  // robotic "Хм every turn" feel.
  const FILLERS = ['hmm', 'tak', 'aga', 'ponyatno', 'horosho'];
  const fillerSlug = FILLERS[Math.floor(Math.random() * FILLERS.length)];
  const origin = new URL(request.url).origin;
  const fillerPromise: Promise<string | null> = fetch(`${origin}/audio/fillers/${fillerSlug}.mp3`)
    .then(async (fr) => {
      if (!fr.ok) return null;
      const u8 = new Uint8Array(await fr.arrayBuffer());
      let bin = '';
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return btoa(bin);
    })
    .catch(() => null);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        // [V1] Emit filler ASAP — TTFA collapses to ~50ms regardless of
        // downstream STT/Claude/TTS latency. Don't await STT first.
        const fillerB64 = await fillerPromise;
        if (fillerB64) {
          send({ type: 'audio_chunk', seq: -1, sentence: fillerSlug, audio_b64: fillerB64 });
        }

        // STT runs inside the stream now so the response can begin streaming
        // before STT completes (the filler covers the audio gap).
        let userTranscript = '';
        if (!body.bootstrap) {
          userTranscript = await azureRecognize(audio as Blob, azureKey, azureRegion).catch(() => '');
        }
        send({ type: 'user_transcript', text: userTranscript });

        // If silent on a non-bootstrap turn, skip Claude entirely.
        if (!body.bootstrap && !userTranscript.trim()) {
          const reply = RETRY_PROMPTS[body.history.length % RETRY_PROMPTS.length];
          await emitSentence(reply, 0, send, azureKey, azureRegion);
          send({ type: 'done', tutor_full: reply });
          controller.close();
          return;
        }

        // Stream Claude. Buffer by sentence. Emit each sentence's audio as it lands.
        const messages: ChatTurn[] = [
          ...body.history,
          ...(userTranscript ? [{ role: 'user' as const, text: userTranscript }] : []),
        ];

        let fullReply = '';
        let buffer = '';
        let seq = 0;
        const sentenceRe = /([^.!?]+[.!?]+)\s*/;

        for await (const delta of streamClaude(systemPrompt, messages, anthropicKey, body.bootstrap === true)) {
          fullReply += delta;
          buffer += delta;
          // Emit any complete sentences in buffer
          let m: RegExpMatchArray | null;
          while ((m = buffer.match(sentenceRe))) {
            const sentence = m[1].trim();
            buffer = buffer.slice(m[0].length);
            if (sentence) {
              await emitSentence(sentence, seq++, send, azureKey, azureRegion);
            }
          }
        }
        // Flush whatever's left
        const tail = buffer.trim();
        if (tail) await emitSentence(tail, seq++, send, azureKey, azureRegion);

        if (!fullReply.trim()) {
          // Claude returned nothing — fall back gracefully
          const reply = "Hmm, I lost my train of thought. What were you saying?";
          await emitSentence(reply, seq++, send, azureKey, azureRegion);
          fullReply = reply;
        }

        send({ type: 'done', tutor_full: fullReply });
        controller.close();
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache, no-store',
      'x-accel-buffering': 'no', // hint for any buffering proxies
    },
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function emitSentence(
  sentence: string,
  seq: number,
  send: (obj: unknown) => void,
  key: string,
  region: string,
): Promise<void> {
  try {
    const ssml = buildSsml(sentence);
    const mp3 = await synthesizeFromSsml(ssml, { key, region });
    // Cloudflare Workers Buffer fallback: use base64 via btoa on a binary string.
    const u8 = new Uint8Array(mp3);
    let binary = '';
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    const b64 = btoa(binary);
    send({ type: 'audio_chunk', seq, sentence, audio_b64: b64 });
  } catch (err) {
    send({ type: 'tts_error', seq, sentence, message: String(err).slice(0, 200) });
  }
}

async function* streamClaude(
  systemPrompt: string,
  messages: ChatTurn[],
  apiKey: string,
  bootstrap: boolean,
): AsyncGenerator<string> {
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
      max_tokens: 400,
      temperature: 0.4,
      stream: true,
      system: systemPrompt,
      messages: userMessages,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => '')}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    // Anthropic streams SSE: "event: ...\ndata: {...}\n\n"
    let idx;
    while ((idx = pending.indexOf('\n\n')) !== -1) {
      const event = pending.slice(0, idx);
      pending = pending.slice(idx + 2);
      const lines = event.split('\n');
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
          yield parsed.delta.text;
        }
      } catch { /* ignore parse errors */ }
    }
  }
}

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
    if (data.RecognitionStatus && data.RecognitionStatus !== 'Success') return { text: '', confidence: 0 };
    const best = data.NBest?.[0];
    return { text: best?.Display ?? data.DisplayText ?? '', confidence: best?.Confidence ?? 0 };
  };
  const ru = await recognize('ru-RU');
  if (ru.text && ru.confidence >= 0.6) return ru.text;
  const en = await recognize('en-US');
  if (en.text) return en.text;
  return ru.text;
}

function pickAzureContentType(mime: string): string {
  if (mime.includes('webm')) return 'audio/webm; codecs=opus';
  if (mime.includes('ogg')) return 'audio/ogg; codecs=opus';
  return 'audio/wav; codecs=audio/pcm; samplerate=16000';
}

function getEnv(locals: App.Locals | undefined, key: string): string | undefined {
  const fromProc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const fromRuntime = (locals as unknown as { runtime?: { env?: Record<string, string | undefined> } })?.runtime?.env?.[key];
  return fromRuntime ?? fromProc;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
