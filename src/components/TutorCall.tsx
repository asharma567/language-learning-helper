// In-call screen for the fluid (no-button) Azure-backed AI voice tutor.
//
// Continuous mic + silero VAD + barge-in. No "hold to talk" — user just
// talks naturally and Sveta responds when they pause. Interruption works:
// start speaking while Sveta is mid-sentence and her audio cuts off
// immediately so you can take the floor.

import { useEffect, useRef, useState } from 'react';
import {
  createFluidTutor,
  type FluidStatus,
  type FluidTutorSession,
} from '../services/azure-tutor-stream';
import type { ScenarioId } from '../lib/lexicon';

type Props = {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  onExit: () => void;
};

type TranscriptLine = {
  id: string;
  speaker: 'user' | 'tutor';
  text: string;
};

const HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10-min auto-end (hard cap)

function looksRussian(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text);
}

const STATUS_TEXT: Record<FluidStatus, string> = {
  connecting: 'Connecting…',
  tutor_speaking: 'Sveta speaking',
  idle: 'Listening — just talk',
  user_speaking: "I'm listening…",
  thinking: 'Thinking…',
  ended: 'Call ended',
  error: 'Error',
};

export default function TutorCall({ scenarioId, scenarioTitle, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<FluidTutorSession | null>(null);
  const [status, setStatus] = useState<FluidStatus>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const session = createFluidTutor({ scenarioId, audioElement: audioEl });
    sessionRef.current = session;

    const off = session.on((evt) => {
      if (cancelled) return;
      switch (evt.type) {
        case 'status':
          setStatus(evt.status);
          break;
        case 'transcript':
          setTranscript((t) => [
            ...t,
            {
              id: `${evt.speaker}-${Date.now()}-${Math.random()}`,
              speaker: evt.speaker,
              text: evt.text,
            },
          ]);
          break;
        case 'error':
          setErrorMsg(evt.message);
          break;
      }
    });

    session.start().catch((err) => {
      if (!cancelled) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    });

    const timeoutId = setTimeout(() => {
      session.stop();
    }, HARD_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      off();
      session.stop();
    };
  }, [scenarioId]);

  function handleEnd() {
    sessionRef.current?.stop();
    onExit();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }

  // Orb is "active" when there's audio motion in either direction.
  const orbActive = status === 'tutor_speaking' || status === 'user_speaking';
  const orbColor =
    status === 'user_speaking'
      ? 'from-emerald-400/80 to-cyan-400/80'
      : 'from-purple-500/80 to-accent-blue/80';

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-navy-900 px-6 py-10">
      {/* Hidden audio sink — playsInline is critical for iOS Safari */}
      <audio ref={audioRef} playsInline />

      <div className="w-full text-center">
        <p className="text-xs uppercase tracking-wider text-text-mute">{scenarioTitle}</p>
        <p className="mt-1 text-sm text-white/70">
          {muted ? 'Muted' : STATUS_TEXT[status]}
        </p>
      </div>

      <div className="flex flex-col items-center justify-center gap-8">
        <div
          className={`relative h-44 w-44 rounded-full bg-gradient-to-br ${orbColor} transition-all duration-300 ${
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

        <p className="max-w-xs text-center text-xs text-text-mute">
          💡 Just speak naturally. To interrupt Sveta, start talking.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={toggleMute}
          disabled={status === 'connecting' || status === 'ended' || status === 'error'}
          className="rounded-xl border border-white/20 px-6 py-3 text-sm text-white/80 disabled:opacity-40"
        >
          {muted ? '🎙️ Unmute' : '🔇 Mute'}
        </button>
        <button
          type="button"
          onClick={handleEnd}
          className="rounded-xl bg-red-500/90 px-6 py-4 text-base font-semibold text-white transition hover:bg-red-500"
        >
          End call
        </button>
      </div>
    </div>
  );
}
