// Fluid (no-button) voice tutor session.
//
// Replaces push-to-talk with continuous mic + silero VAD. Detects user speech
// boundaries automatically; supports BARGE-IN (user starts speaking →
// tutor's audio is paused immediately).
//
// State machine:
//
//   connecting → tutor_speaking → idle ↔ user_speaking → thinking → tutor_speaking → ...
//                                  ▲                                       │
//                                  └───────────────────────────────────────┘
//
//   - Sveta opens with a greeting (server bootstrap call) → tutor_speaking
//   - When her audio ends → idle (mic listening, VAD running)
//   - User speaks → user_speaking. If tutor was still speaking, pause her.
//   - User stops (VAD silence ~700ms) → thinking. POST audio frames.
//   - Server returns mp3 → tutor_speaking → loop.
//
// Echo guard: with `echoCancellation: true` on the mic stream, browser-level
// AEC suppresses speaker bleed. We additionally require ≥3 VAD-positive frames
// for barge-in to trigger (silero's default redemption_frames handles this) —
// reduces false barge-ins from spurious echo blips.

// Note: VAD lib is dynamic-imported inside start() to keep it out of the
// initial bundle — adds ~400 KB of WASM + ONNX runtime that we only need
// when the user actually opens the tutor.
import { float32ToWav } from './audio-convert';
import type { ChatTurn } from '../lib/tutor-conversation';

export type FluidTutorEvent =
  | { type: 'status'; status: FluidStatus }
  | { type: 'transcript'; speaker: 'user' | 'tutor'; text: string }
  | { type: 'error'; message: string };

export type FluidStatus =
  | 'connecting'
  | 'tutor_speaking'
  | 'idle'
  | 'user_speaking'
  | 'thinking'
  | 'ended'
  | 'error';

export type FluidTutorHandler = (event: FluidTutorEvent) => void;

export interface FluidTutorSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
  on(handler: FluidTutorHandler): () => void;
}

export type FluidTutorOptions = {
  scenarioId: string;
  audioElement: HTMLAudioElement;
};

type StreamCallbacks = {
  onUserTranscript?: (text: string) => void;
  onAudioChunk: (url: string, sentence: string, seq: number) => void;
  onDone: (fullTutorText: string) => void;
  onError?: (msg: string) => void;
};

async function streamTurn(
  meta: { scenarioId: string; history: ChatTurn[]; bootstrap: boolean },
  audioWav: Blob | undefined,
  cbs: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const fd = new FormData();
  fd.append('meta', JSON.stringify(meta));
  if (audioWav) fd.append('audio', audioWav, 'turn.wav');
  const res = await fetch('/api/tutor/turn-stream', { method: 'POST', body: fd, signal });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tutor turn-stream ${res.status}: ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let fullTutor = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, idx).trim();
      pending = pending.slice(idx + 1);
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt.type === 'user_transcript') {
        cbs.onUserTranscript?.(evt.text ?? '');
      } else if (evt.type === 'audio_chunk') {
        const bin = atob(evt.audio_b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        cbs.onAudioChunk(url, evt.sentence ?? '', evt.seq ?? 0);
        fullTutor += (fullTutor ? ' ' : '') + (evt.sentence ?? '');
      } else if (evt.type === 'done') {
        fullTutor = evt.tutor_full ?? fullTutor;
      } else if (evt.type === 'error' || evt.type === 'tts_error') {
        cbs.onError?.(evt.message ?? 'unknown stream error');
      }
    }
  }
  cbs.onDone(fullTutor);
}

export function createFluidTutor(opts: FluidTutorOptions): FluidTutorSession {
  const { scenarioId, audioElement } = opts;
  const handlers = new Set<FluidTutorHandler>();
  const emit = (e: FluidTutorEvent) => { for (const h of handlers) h(e); };
  const setStatus = (s: FluidStatus) => emit({ type: 'status', status: s });

  // VAD instance lives here once initialized. Type is inferred to avoid
  // pulling MicVAD type into the surface API of this module.
  let vad: { start(): void; pause(): void; destroy(): void } | null = null;
  let history: ChatTurn[] = [];
  let muted = false;
  let lastUrl: string | null = null;
  let stopped = false;
  let inFlightAbort: AbortController | null = null;
  // Latest audio URL the tutor is playing — when barge-in fires, we revoke it.
  // Used to also gate against playing a stale response if the user has bargedin
  // again before the prior request finished.
  let currentTurnId = 0;

  function stopTutorAudio(): void {
    try {
      audioElement.pause();
      audioElement.currentTime = 0;
    } catch { /* ignore */ }
  }

  function playMp3(url: string, expectedTurn: number): Promise<void> {
    return new Promise((resolve) => {
      if (stopped || expectedTurn !== currentTurnId) {
        URL.revokeObjectURL(url);
        return resolve();
      }
      if (lastUrl && lastUrl !== url) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      audioElement.src = url;
      const cleanup = () => {
        audioElement.removeEventListener('ended', cleanup);
        audioElement.removeEventListener('error', cleanup);
        resolve();
      };
      audioElement.addEventListener('ended', cleanup);
      audioElement.addEventListener('error', cleanup);
      audioElement.play().catch(() => resolve());
    });
  }

  // Plays mp3 chunks sequentially. Each enqueue plays after the previous
  // chunk's `ended` event so there are no overlaps or gaps.
  async function playChunkQueue(urls: string[], expectedTurn: number): Promise<void> {
    for (const url of urls) {
      if (stopped || expectedTurn !== currentTurnId) {
        URL.revokeObjectURL(url);
        continue;
      }
      await playMp3(url, expectedTurn);
    }
  }

  async function handleUserUtterance(audio: Float32Array): Promise<void> {
    if (stopped) return;
    const turnId = ++currentTurnId;
    setStatus('thinking');
    inFlightAbort?.abort();
    const abort = new AbortController();
    inFlightAbort = abort;

    // Streaming model: chunks arrive over time. We enqueue + serialize playback.
    const urlQueue: string[] = [];
    let userTextCaptured = false;
    let playbackChain: Promise<void> = Promise.resolve();

    function enqueueChunk(url: string) {
      urlQueue.push(url);
      // Trigger playback if not already running
      playbackChain = playbackChain.then(async () => {
        while (urlQueue.length > 0) {
          if (stopped || turnId !== currentTurnId) {
            const u = urlQueue.shift();
            if (u) URL.revokeObjectURL(u);
            continue;
          }
          if (urlQueue.length === 1) setStatus('tutor_speaking');
          const next = urlQueue.shift()!;
          await playMp3(next, turnId);
        }
      });
    }

    try {
      const wav = float32ToWav(audio, 16000);
      await streamTurn(
        { scenarioId, history, bootstrap: false },
        wav,
        {
          onUserTranscript: (text) => {
            if (text.trim() && !userTextCaptured) {
              userTextCaptured = true;
              emit({ type: 'transcript', speaker: 'user', text });
              history.push({ role: 'user', text });
            }
          },
          onAudioChunk: (url) => enqueueChunk(url),
          onDone: (fullTutor) => {
            if (fullTutor.trim()) {
              emit({ type: 'transcript', speaker: 'tutor', text: fullTutor });
              history.push({ role: 'assistant', text: fullTutor });
            }
          },
          onError: (msg) => emit({ type: 'error', message: msg }),
        },
        abort.signal,
      );
      // Wait for the playback chain to finish so status returns to idle correctly
      await playbackChain;
      if (!stopped && turnId === currentTurnId) setStatus('idle');
    } catch (err) {
      // AbortError is expected when user barges in mid-request — silent.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!stopped) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        setStatus('idle');
      }
    }
  }

  return {
    async start() {
      setStatus('connecting');

      // 1. Bootstrap greeting via streaming endpoint (no audio input yet).
      try {
        const turnId = ++currentTurnId;
        const urlQueue: string[] = [];
        let chain: Promise<void> = Promise.resolve();
        const enqueue = (url: string) => {
          urlQueue.push(url);
          chain = chain.then(async () => {
            while (urlQueue.length > 0) {
              if (stopped || turnId !== currentTurnId) {
                const u = urlQueue.shift();
                if (u) URL.revokeObjectURL(u);
                continue;
              }
              if (urlQueue.length === 1) setStatus('tutor_speaking');
              const next = urlQueue.shift()!;
              await playMp3(next, turnId);
            }
          });
        };
        await streamTurn(
          { scenarioId, history: [], bootstrap: true },
          undefined,
          {
            onAudioChunk: (url) => enqueue(url),
            onDone: (fullTutor) => {
              if (fullTutor.trim()) {
                emit({ type: 'transcript', speaker: 'tutor', text: fullTutor });
                history.push({ role: 'assistant', text: fullTutor });
              }
            },
            onError: (msg) => emit({ type: 'error', message: msg }),
          },
        );
        await chain;
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        setStatus('error');
        return;
      }

      if (stopped) return;
      setStatus('idle');

      // 2. Start VAD on continuous mic. Frames are 16kHz mono Float32.
      try {
        // Dynamic import keeps the heavy VAD bundle out of the initial JS.
        const [{ MicVAD }, ort] = await Promise.all([
          import('@ricky0123/vad-web'),
          import('onnxruntime-web'),
        ]);
        // ONNX runtime needs to know where its WASM blobs live. We self-host
        // them under /vad/ as static assets (copied from node_modules at
        // build time — see scripts/copy-vad-assets.mjs).
        ort.env.wasm.wasmPaths = '/vad/';
        vad = await MicVAD.new({
          // Use the v5 silero model — better quality + smaller than v4.
          model: 'v5',
          // Self-hosted VAD assets (silero model + audio worklet).
          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
          additionalAudioConstraints: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
          // Speech end is declared after this many silence frames (~32ms each).
          // 22 ≈ ~700ms — matches our chosen turn-detection threshold.
          redemptionFrames: 22,
          // Only fire onSpeechEnd if we accumulated at least this many frames
          // of speech (~250ms). Filters echo/cough false positives.
          minSpeechFrames: 8,
          onSpeechStart: () => {
            if (muted || stopped) return;
            // BARGE-IN: if Sveta is talking, pause her right now.
            // Also abort any in-flight HTTP turn — its response is stale and
            // would talk over the user's new utterance when it arrives.
            stopTutorAudio();
            inFlightAbort?.abort();
            setStatus('user_speaking');
          },
          onSpeechEnd: (audio) => {
            if (muted || stopped) return;
            // Hand off to async handler; VAD continues collecting in background.
            handleUserUtterance(audio).catch((err) => {
              emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
            });
          },
          onVADMisfire: () => {
            // Speech detected then revoked before minSpeechFrames threshold.
            // Quietly return to idle — likely an echo blip or cough.
            if (!stopped && !muted) setStatus('idle');
          },
        });
        vad.start();
      } catch (err) {
        emit({ type: 'error', message: `VAD init failed: ${String(err)}` });
        setStatus('error');
      }
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      try { vad?.destroy(); } catch { /* ignore */ }
      vad = null;
      stopTutorAudio();
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = null;
      setStatus('ended');
    },

    setMuted(value: boolean) {
      muted = value;
      if (muted) {
        try { vad?.pause(); } catch { /* ignore */ }
      } else {
        try { vad?.start(); } catch { /* ignore */ }
      }
    },

    on(handler) {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
  };
}
