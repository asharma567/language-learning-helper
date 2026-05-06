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
  stripMarkdownForTts,
  type ChatTurn,
} from '../../../lib/tutor-conversation';
import { synthesizeFromSsml } from '../../../lib/azure-speech';
import { synthesizeWithElevenLabs } from '../../../lib/elevenlabs-tts';
import { FILLER_AUDIO_B64, FILLER_SLUGS } from '../../../lib/tutor-fillers';

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
  const elevenKey = getEnv(locals, 'ELEVENLABS_API_KEY');
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

  // [V1] Optimistic filler — pick a random pre-rendered Russian
  // acknowledgment, INLINED into the worker bundle as base64 (see
  // src/lib/tutor-fillers.ts). Avoids a same-domain subrequest from
  // CF Worker → static asset which adds ~1s on edge cold start.
  const fillerSlug = FILLER_SLUGS[Math.floor(Math.random() * FILLER_SLUGS.length)];
  const fillerB64 = FILLER_AUDIO_B64[fillerSlug] ?? null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        // [V1] Emit filler ASAP — TTFA collapses to ~50ms regardless of
        // downstream STT/Claude/TTS latency. Don't await STT first.
        if (fillerB64) {
          send({ type: 'audio_chunk', seq: -1, sentence: fillerSlug, audio_b64: fillerB64 });
        }

        // [V9] Speculative Claude — try to start Claude in PARALLEL with STT
        // by predicting what the user said from the last assistant turn (e.g.
        // when Sveta said "Try saying X", users almost always say X). If
        // STT confirms the prediction, we save ~600ms (the STT delay). If
        // STT differs, we abort the speculative Claude and run a real one.
        const predicted = body.bootstrap ? null : predictUserUtterance(body.history);
        const speculativeAbort = new AbortController();
        const speculativeBuf = predicted
          ? eagerCollect(streamClaude(systemPrompt,
              [...body.history, { role: 'user', text: predicted }],
              anthropicKey, false, speculativeAbort.signal))
          : null;

        // STT runs in PARALLEL with the speculative Claude (if any).
        const sttPromise: Promise<string> = body.bootstrap
          ? Promise.resolve('')
          : azureRecognize(audio as Blob, azureKey, azureRegion).catch(() => '');
        const userTranscript = await sttPromise;
        send({ type: 'user_transcript', text: userTranscript });

        // If silent on a non-bootstrap turn, skip Claude entirely.
        if (!body.bootstrap && !userTranscript.trim()) {
          speculativeAbort.abort();
          const reply = RETRY_PROMPTS[body.history.length % RETRY_PROMPTS.length];
          await emitSentence(reply, 0, send, azureKey, azureRegion);
          send({ type: 'done', tutor_full: reply });
          controller.close();
          return;
        }

        // Decide: did the speculation match? If yes, replay+continue the
        // speculative stream. If no, abort and start a fresh Claude call.
        let claudeStream: AsyncIterable<string>;
        if (speculativeBuf && predicted && transcriptMatches(userTranscript, predicted)) {
          claudeStream = speculativeBuf.replay();
        } else {
          if (speculativeBuf) speculativeAbort.abort();
          const messages: ChatTurn[] = [
            ...body.history,
            ...(userTranscript ? [{ role: 'user' as const, text: userTranscript }] : []),
          ];
          claudeStream = streamClaude(systemPrompt, messages, anthropicKey, body.bootstrap === true);
        }

        let fullReply = '';
        let buffer = '';
        let seq = 0;
        const sentenceRe = /([^.!?]+[.!?]+)\s*/;

        // [V3] Parallel TTS: kick off each sentence's synthesis the moment
        // its boundary lands, but emit in strict order via a Promise chain.
        // Sentence N's TTS runs concurrently with sentence N+1's, so total
        // pipeline time approaches max(sentence_TTS) instead of sum.
        let emitChain: Promise<void> = Promise.resolve();
        const launchSentence = (sentence: string, n: number): void => {
          // Prefer ElevenLabs Multilingual v2 (dramatically more natural Russian
          // than Azure ru-RU-Svetlana). Fall back to Azure SSML if ElevenLabs
          // errors (rate limit, quota, transient) so the conversation never breaks.
          // ElevenLabs Multilingual v2 sounds dramatically more natural than
          // Azure ru-RU-Svetlana, BUT ElevenLabs free tier blocks requests
          // from datacenter IPs (CF Workers) with "detected_unusual_activity"
          // 401 — they require a paid plan to use from servers. Until the
          // user upgrades, this fallback path runs in PROD. Local dev with
          // a residential IP works.
          const ttsP = elevenKey
            ? synthesizeWithElevenLabs(stripMarkdownForTts(sentence), { apiKey: elevenKey })
                .catch(() => synthesizeFromSsml(buildSsml(sentence), { key: azureKey, region: azureRegion }))
            : synthesizeFromSsml(buildSsml(sentence), { key: azureKey, region: azureRegion });
          emitChain = emitChain.then(async () => {
            try {
              const mp3 = await ttsP;
              const u8 = new Uint8Array(mp3);
              let bin = '';
              for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
              send({ type: 'audio_chunk', seq: n, sentence, audio_b64: btoa(bin) });
            } catch (err) {
              send({ type: 'tts_error', seq: n, sentence, message: String(err).slice(0, 200) });
            }
          });
        };

        for await (const delta of claudeStream) {
          fullReply += delta;
          buffer += delta;
          let m: RegExpMatchArray | null;
          while ((m = buffer.match(sentenceRe))) {
            const sentence = m[1].trim();
            buffer = buffer.slice(m[0].length);
            if (sentence) launchSentence(sentence, seq++);
          }
        }
        const tail = buffer.trim();
        if (tail) launchSentence(tail, seq++);
        await emitChain;

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
  abortSignal?: AbortSignal,
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
    signal: abortSignal,
  });
  if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => '')}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    if (abortSignal?.aborted) { try { reader.cancel(); } catch {} return; }
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

// [V9] Predict what the user is about to say based on Sveta's last turn.
// Sveta's prompts overwhelmingly follow the pattern: "Try saying X" or
// "Try X" or end with a Russian phrase in quotes. When that's there, the
// user's response is overwhelmingly a repetition of X. We extract X for
// speculative Claude. Returns null if no clear prediction available.
function predictUserUtterance(history: ChatTurn[]): string | null {
  const last = [...history].reverse().find((t) => t.role === 'assistant');
  if (!last) return null;
  const text = last.text;

  // Pattern 1: "Try saying X" or "Now try X" or "Try X" — capture trailing
  // Russian-letter phrase. Russian letter range: Ѐ-ӿ.
  const tryMatch = text.match(/(?:try(?:\s+saying)?|now\s+try)\s*[:"'«]*\s*([Ѐ-ӿ][Ѐ-ӿ\s,!?'.\-—]*?)["'»\.\?!]*\s*(?:$|[\(—–\-])/i);
  if (tryMatch && tryMatch[1].trim().length >= 3) {
    return tryMatch[1].trim().replace(/[«»"']/g, '').trim();
  }

  // Pattern 2: Russian phrase in quotes — most likely the target phrase.
  const quoteMatch = text.match(/[«"']([Ѐ-ӿ][Ѐ-ӿ\s,!?'.\-—]+?)[»"']/);
  if (quoteMatch && quoteMatch[1].trim().length >= 3) {
    return quoteMatch[1].trim();
  }

  // Pattern 3: standalone Russian phrase at end of message (e.g. "...something something — ты красивая.")
  const tailMatch = text.match(/[—–\-:]\s*([Ѐ-ӿ][Ѐ-ӿ\s,!?'.]+?)[\.\?!]\s*$/);
  if (tailMatch && tailMatch[1].trim().length >= 3) {
    return tailMatch[1].trim();
  }

  return null;
}

// [V9] Compare STT result with prediction. Normalize both: lowercase, strip
// punctuation, collapse spaces. A match means the words largely overlap.
function transcriptMatches(actual: string, predicted: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[ё]/g, 'е')
      .replace(/[^Ѐ-ӿa-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const a = norm(actual);
  const p = norm(predicted);
  if (!a || !p) return false;
  if (a === p) return true;
  // Word overlap: at least 70% of predicted words appear in actual.
  const pwords = p.split(' ').filter((w) => w.length > 1);
  if (pwords.length === 0) return false;
  const aset = new Set(a.split(' '));
  const hits = pwords.filter((w) => aset.has(w)).length;
  return hits / pwords.length >= 0.7;
}

// [V9] Eagerly drain an AsyncIterable into a buffer that can be replayed.
// Used to pre-spool speculative Claude tokens while STT runs, so when STT
// confirms the prediction we can immediately replay everything received so
// far and then continue consuming new tokens as they arrive.
function eagerCollect<T>(source: AsyncIterable<T>): {
  replay: () => AsyncIterable<T>;
} {
  const buf: T[] = [];
  let done = false;
  let err: unknown = null;
  let waiters: Array<() => void> = [];
  const wake = () => { const w = waiters; waiters = []; for (const f of w) f(); };
  (async () => {
    try {
      for await (const x of source) { buf.push(x); wake(); }
    } catch (e) { err = e; }
    finally { done = true; wake(); }
  })();
  return {
    replay: () => ({
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          async next(): Promise<IteratorResult<T>> {
            while (true) {
              if (i < buf.length) return { value: buf[i++], done: false };
              if (done) {
                if (err) throw err;
                return { value: undefined as unknown as T, done: true };
              }
              await new Promise<void>((res) => { waiters.push(res); });
            }
          },
        };
      },
    }),
  };
}
