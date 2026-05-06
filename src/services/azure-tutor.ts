// Browser-side push-to-talk tutor session backed by Azure STT + Anthropic
// Claude + Azure TTS. Replaces the OpenAI-realtime path which was blocked
// by quota.
//
// Flow per turn:
//   1. user taps mic → startRecording()
//   2. user releases → stopRecording() returns webm blob
//   3. blobToPcmWav (Azure prefers PCM)
//   4. POST blob + history JSON to /api/tutor/turn
//   5. response: audio body + transcripts in headers
//   6. play audio, append both transcripts to history

import { startRecording, type Recorder } from '../lib/recorder';
import { blobToPcmWav } from './audio-convert';
import type { ChatTurn } from '../lib/tutor-conversation';

export type TurnResult = {
  userTranscript: string;
  tutorTranscript: string;
  audioUrl: string; // blob: URL — caller should revoke when done
};

export async function bootstrapGreeting(scenarioId: string): Promise<TurnResult> {
  return postTurn({ scenarioId, history: [], bootstrap: true });
}

export async function userTurn(
  scenarioId: string,
  history: ChatTurn[],
  audioBlob: Blob,
): Promise<TurnResult> {
  const wav = await blobToPcmWav(audioBlob);
  return postTurn({ scenarioId, history, bootstrap: false }, wav);
}

async function postTurn(
  meta: { scenarioId: string; history: ChatTurn[]; bootstrap: boolean },
  audioWav?: Blob,
): Promise<TurnResult> {
  const fd = new FormData();
  fd.append('meta', JSON.stringify(meta));
  if (audioWav) fd.append('audio', audioWav, 'turn.wav');

  const res = await fetch('/api/tutor/turn', { method: 'POST', body: fd });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tutor turn failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  const blob = await res.blob();
  const audioUrl = URL.createObjectURL(blob);
  const userTranscript = decodeURIComponent(res.headers.get('x-user-transcript') ?? '');
  const tutorTranscript = decodeURIComponent(res.headers.get('x-tutor-transcript') ?? '');
  return { userTranscript, tutorTranscript, audioUrl };
}

export type AzureTutorRecorder = {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
};

export async function startTurnRecording(): Promise<AzureTutorRecorder> {
  const rec: Recorder = await startRecording();
  return {
    async start() { /* already started by startRecording */ },
    stop: () => rec.stop(),
    cancel: () => rec.cancel(),
  };
}
