// Browser-side WebRTC client for the OpenAI Realtime API.
//
// Flow:
//   1. POST /api/realtime/session → get ephemeral client_secret + scenario context
//   2. createOffer(), POST SDP to https://api.openai.com/v1/realtime/calls?model=...
//   3. setRemoteDescription(answer)
//   4. Listen on data channel for transcript + status events
//   5. On stop(): close connection, stop tracks
//
// Designed React-free so the same module can be unit-tested in node-with-mocks
// and reused outside React if we ever add a non-React surface.

import type {
  RealtimeIncomingEvent,
  RealtimeOutgoingEvent,
} from '../lib/realtime-events';
import { isIncomingEvent } from '../lib/realtime-events';

export type TutorEvent =
  | { type: 'connecting' }
  | { type: 'ready' }
  | { type: 'user_speech_started' }
  | { type: 'user_speech_stopped' }
  | { type: 'user_transcript'; text: string }
  | { type: 'tutor_transcript_delta'; text: string }
  | { type: 'tutor_transcript_done'; text: string }
  | { type: 'tutor_speaking_started' }
  | { type: 'tutor_speaking_stopped' }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'closed'; reason: 'user' | 'remote' | 'error' };

export type TutorEventHandler = (event: TutorEvent) => void;

export interface RealtimeTutorSession {
  start(): Promise<void>;
  stop(): void;
  /** Send a `response.cancel` so the tutor stops talking immediately. */
  interrupt(): void;
  setMuted(muted: boolean): void;
  on(handler: TutorEventHandler): () => void;
}

export type SessionMintResponse = {
  client_secret: string;
  expires_at?: number;
  model: string;
  voice: string;
  scenario_id: string;
  scenario_title: string;
  phrase_count: number;
};

export async function mintSession(scenarioId: string): Promise<SessionMintResponse> {
  const res = await fetch('/api/realtime/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`session mint failed: ${res.status}${detail ? ` ${detail}` : ''}`);
  }
  return (await res.json()) as SessionMintResponse;
}

export type CreateSessionOpts = {
  ephemeralKey: string;
  model: string;
  audioElement: HTMLAudioElement;
};

export function createTutorSession(opts: CreateSessionOpts): RealtimeTutorSession {
  const { ephemeralKey, model, audioElement } = opts;
  const handlers = new Set<TutorEventHandler>();
  const emit = (e: TutorEvent) => {
    for (const h of handlers) h(e);
  };

  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let started = false;
  let closed = false;

  function sendEvent(ev: RealtimeOutgoingEvent): void {
    if (!dc || dc.readyState !== 'open') return;
    dc.send(JSON.stringify(ev));
  }

  function handleServerEvent(raw: unknown): void {
    if (!isIncomingEvent(raw)) return;
    switch (raw.type) {
      case 'session.created':
      case 'session.updated':
        emit({ type: 'ready' });
        break;
      case 'input_audio_buffer.speech_started':
        emit({ type: 'user_speech_started' });
        break;
      case 'input_audio_buffer.speech_stopped':
        emit({ type: 'user_speech_stopped' });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        emit({ type: 'user_transcript', text: raw.transcript });
        break;
      case 'response.created':
        emit({ type: 'tutor_speaking_started' });
        break;
      case 'response.output_audio_transcript.delta':
        emit({ type: 'tutor_transcript_delta', text: raw.delta });
        break;
      case 'response.output_audio_transcript.done':
        emit({ type: 'tutor_transcript_done', text: raw.transcript });
        break;
      case 'response.done':
      case 'response.output_audio.done':
        emit({ type: 'tutor_speaking_stopped' });
        break;
      case 'error':
        emit({
          type: 'error',
          message: raw.error.message ?? 'unknown realtime error',
          recoverable: raw.error.code !== 'session_expired',
        });
        break;
      default:
        // Unhandled event type — fine to ignore.
        break;
    }
  }

  return {
    async start() {
      if (started) throw new Error('session already started');
      started = true;
      emit({ type: 'connecting' });

      try {
        // 1. Mic capture. WebRTC will negotiate sample rate; we just ask for
        //    echoCancellation + noiseSuppression to clean things up server-side.
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });

        // 2. Build the peer connection.
        pc = new RTCPeerConnection();

        // 2a. Outbound audio (mic).
        for (const track of micStream.getTracks()) pc.addTrack(track, micStream);

        // 2b. Inbound audio (tutor voice) → attach to <audio> element.
        pc.ontrack = (e) => {
          audioElement.srcObject = e.streams[0];
          // iOS Safari: must be invoked from a user-gesture chain. The caller
          // (TutorCallSetup's "Start" button click handler) is that chain.
          audioElement.play().catch(() => {
            // Already playing or autoplay blocked. Surface as soft warning.
          });
        };

        // 2c. Data channel for events. MUST be created before createOffer.
        dc = pc.createDataChannel('oai-events');
        dc.onopen = () => {
          // Reaffirm session config (the mint endpoint already configured the
          // session, but a session.update here is a useful no-op + handshake).
          // We intentionally do NOT override the system prompt here — it lives
          // server-side in the minted session.
        };
        dc.onmessage = (msg) => {
          try {
            const parsed = JSON.parse(msg.data);
            handleServerEvent(parsed);
          } catch {
            // Non-JSON message — ignore.
          }
        };
        dc.onerror = () => {
          emit({ type: 'error', message: 'data channel error', recoverable: false });
        };

        pc.onconnectionstatechange = () => {
          if (!pc) return;
          const state = pc.connectionState;
          if (state === 'failed' || state === 'disconnected') {
            emit({
              type: 'error',
              message: `connection ${state}`,
              recoverable: state === 'disconnected',
            });
          }
          if (state === 'closed') {
            if (!closed) emit({ type: 'closed', reason: 'remote' });
          }
        };

        // 3. SDP offer/answer with OpenAI realtime.
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch(
          `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${ephemeralKey}`,
              'content-type': 'application/sdp',
            },
            body: offer.sdp,
          },
        );

        if (!sdpRes.ok) {
          const detail = await sdpRes.text().catch(() => '');
          throw new Error(`SDP exchange failed: ${sdpRes.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
        }

        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        // 'ready' will fire from session.created event over data channel.
      } catch (err) {
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          recoverable: false,
        });
        this.stop();
      }
    },

    stop() {
      if (closed) return;
      closed = true;
      try {
        if (dc) dc.close();
      } catch { /* ignore */ }
      try {
        if (pc) pc.close();
      } catch { /* ignore */ }
      if (micStream) {
        for (const t of micStream.getTracks()) t.stop();
      }
      try {
        if (audioElement.srcObject) {
          audioElement.srcObject = null;
        }
        audioElement.pause();
      } catch { /* ignore */ }
      emit({ type: 'closed', reason: 'user' });
    },

    interrupt() {
      sendEvent({ type: 'response.cancel' });
    },

    setMuted(muted: boolean) {
      if (!micStream) return;
      for (const t of micStream.getAudioTracks()) t.enabled = !muted;
    },

    on(handler) {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
  };
}
