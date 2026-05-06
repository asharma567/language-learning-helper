// In-call screen for the Azure-backed AI voice tutor (push-to-talk v0).
//
// Lifecycle:
//   - On mount, calls /api/tutor/turn with bootstrap=true → Sveta's greeting
//   - User holds the big mic button → recording
//   - User releases → upload + STT + Claude + TTS roundtrip → play response
//   - Repeat until "End call"
//
// Code-switching: server returns mixed-language SSML mp3 (Russian phrases
// in Svetlana's voice, English explanations in Jenny's voice — single audio
// blob, seamless playback).

import { useEffect, useRef, useState } from 'react';
import {
  bootstrapGreeting,
  startTurnRecording,
  userTurn,
  type AzureTutorRecorder,
} from '../services/azure-tutor';
import type { ScenarioId } from '../lib/lexicon';
import type { ChatTurn } from '../lib/tutor-conversation';

type Props = {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  onExit: () => void;
};

type CallStatus =
  | 'connecting'
  | 'tutor_speaking'
  | 'idle'        // listening for user to press to talk
  | 'recording'   // user is speaking
  | 'processing'  // upload + STT + Claude + TTS in flight
  | 'error'
  | 'ended';

type TranscriptLine = {
  id: string;
  speaker: 'user' | 'tutor';
  text: string;
};

const HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10-minute auto-end (cap)

function looksRussian(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text);
}

export default function TutorCall({ scenarioId, scenarioTitle, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<AzureTutorRecorder | null>(null);
  const historyRef = useRef<ChatTurn[]>([]);
  const lastUrlRef = useRef<string | null>(null);
  const endedRef = useRef(false);

  const [status, setStatus] = useState<CallStatus>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);

  function appendTranscript(speaker: 'user' | 'tutor', text: string) {
    if (!text.trim()) return;
    setTranscript((t) => [
      ...t,
      { id: `${speaker}-${Date.now()}-${Math.random()}`, speaker, text },
    ]);
  }

  function appendHistory(role: 'user' | 'assistant', text: string) {
    if (!text.trim()) return;
    historyRef.current.push({ role, text });
  }

  async function playAudio(url: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = audioRef.current;
      if (!audio) return resolve();
      // revoke previous blob URL (if any) to free memory
      if (lastUrlRef.current && lastUrlRef.current !== url) {
        URL.revokeObjectURL(lastUrlRef.current);
      }
      lastUrlRef.current = url;
      audio.src = url;
      const onDone = () => {
        audio.removeEventListener('ended', onDone);
        audio.removeEventListener('error', onDone);
        resolve();
      };
      audio.addEventListener('ended', onDone);
      audio.addEventListener('error', onDone);
      audio.play().catch(() => resolve());
    });
  }

  // 1. Bootstrap on mount
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        setStatus('connecting');
        const result = await bootstrapGreeting(scenarioId);
        if (cancelled) return;
        appendTranscript('tutor', result.tutorTranscript);
        appendHistory('assistant', result.tutorTranscript);
        setStatus('tutor_speaking');
        await playAudio(result.audioUrl);
        if (!cancelled) setStatus('idle');
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    timeoutId = setTimeout(() => {
      if (!endedRef.current) handleEnd();
    }, HARD_TIMEOUT_MS);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (recorderRef.current) recorderRef.current.cancel();
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  async function startTalking() {
    if (status !== 'idle') return;
    try {
      const rec = await startTurnRecording();
      recorderRef.current = rec;
      setStatus('recording');
    } catch (err) {
      setErrorMsg(`Mic error: ${String(err)}`);
      setStatus('error');
    }
  }

  async function stopTalkingAndSend() {
    const rec = recorderRef.current;
    if (!rec || status !== 'recording') return;
    recorderRef.current = null;
    setStatus('processing');
    try {
      const audio = await rec.stop();
      const result = await userTurn(scenarioId, historyRef.current, audio);
      appendTranscript('user', result.userTranscript);
      appendHistory('user', result.userTranscript);
      appendTranscript('tutor', result.tutorTranscript);
      appendHistory('assistant', result.tutorTranscript);
      setStatus('tutor_speaking');
      await playAudio(result.audioUrl);
      if (!endedRef.current) setStatus('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  function handleEnd() {
    endedRef.current = true;
    if (recorderRef.current) recorderRef.current.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setStatus('ended');
    onExit();
  }

  const statusText: Record<CallStatus, string> = {
    connecting: 'Connecting…',
    tutor_speaking: 'Sveta speaking',
    idle: 'Hold the mic to talk',
    recording: 'Listening…',
    processing: 'Thinking…',
    error: 'Error',
    ended: 'Call ended',
  };

  const orbActive = status === 'tutor_speaking' || status === 'recording';

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-navy-900 px-6 py-10">
      <audio ref={audioRef} playsInline />

      <div className="w-full text-center">
        <p className="text-xs uppercase tracking-wider text-text-mute">{scenarioTitle}</p>
        <p className="mt-1 text-sm text-white/70">{statusText[status]}</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-8">
        <div
          className={`relative h-44 w-44 rounded-full bg-gradient-to-br from-purple-500/80 to-accent-blue/80 transition-transform duration-500 ${
            orbActive ? 'scale-110 animate-pulse' : 'scale-100'
          }`}
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-full bg-white/10 backdrop-blur" />
        </div>

        <div className="mt-2 w-full max-w-md text-center text-sm">
          {transcript.slice(-4).map((line) => (
            <p
              key={line.id}
              className={`mb-2 ${
                line.speaker === 'tutor' ? 'text-white/85' : 'text-white/55'
              } ${looksRussian(line.text) ? 'font-semibold' : 'italic'}`}
            >
              {line.speaker === 'tutor' ? '👩🏼' : '🧑'} {line.text}
            </p>
          ))}
        </div>

        {errorMsg && (
          <p className="max-w-xs text-center text-xs text-red-300/80">{errorMsg}</p>
        )}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          // Push-to-talk: pointerdown to start, pointerup to send.
          // Touch + mouse handled by the same Pointer Events.
          onPointerDown={startTalking}
          onPointerUp={stopTalkingAndSend}
          onPointerCancel={() => {
            if (recorderRef.current) {
              recorderRef.current.cancel();
              recorderRef.current = null;
            }
            if (status === 'recording') setStatus('idle');
          }}
          disabled={status !== 'idle' && status !== 'recording'}
          className={`rounded-2xl px-6 py-6 text-lg font-semibold text-white transition disabled:opacity-40 ${
            status === 'recording'
              ? 'bg-red-500 ring-4 ring-red-300/40'
              : 'bg-accent-blue hover:opacity-90'
          }`}
        >
          {status === 'recording' ? '● Recording — release to send' : '🎙️ Hold to talk'}
        </button>
        <button
          type="button"
          onClick={handleEnd}
          className="rounded-xl border border-white/20 px-6 py-3 text-sm text-white/80"
        >
          End call
        </button>
      </div>
    </div>
  );
}
