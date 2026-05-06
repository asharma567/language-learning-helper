// In-call screen for the AI voice tutor.
//
// Lifecycle:
//   1. On mount, immediately mints a session and starts WebRTC.
//   2. While connected, displays orb (pulses with audio activity) + live
//      transcript (RU vs EN visually distinguished).
//   3. End-call button stops session, then triggers onExit.

import { useEffect, useRef, useState } from 'react';
import {
  createTutorSession,
  mintSession,
  type RealtimeTutorSession,
  type TutorEvent,
} from '../services/realtime-tutor';
import type { ScenarioId } from '../lib/lexicon';

type Props = {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  onExit: () => void;
};

type CallStatus = 'minting' | 'connecting' | 'listening' | 'speaking' | 'error' | 'closed';

type TranscriptLine = {
  id: string;
  speaker: 'user' | 'tutor';
  text: string;
  /** Russian-script presence is a good proxy for "this turn is in Russian". */
  isRussian: boolean;
};

const HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10-minute auto-end (cap)

function looksRussian(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text);
}

export default function TutorCall({ scenarioId, scenarioTitle, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<RealtimeTutorSession | null>(null);
  const [status, setStatus] = useState<CallStatus>('minting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [muted, setMuted] = useState(false);
  const [tutorPartial, setTutorPartial] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const minted = await mintSession(scenarioId);
        if (cancelled) return;

        const audioEl = audioRef.current;
        if (!audioEl) throw new Error('audio element missing');

        const session = createTutorSession({
          ephemeralKey: minted.client_secret,
          model: minted.model,
          audioElement: audioEl,
        });
        sessionRef.current = session;

        const off = session.on((evt: TutorEvent) => {
          switch (evt.type) {
            case 'connecting':
              setStatus('connecting');
              break;
            case 'ready':
              setStatus('listening');
              break;
            case 'user_speech_started':
              setStatus('listening');
              break;
            case 'user_transcript':
              if (evt.text.trim()) {
                setTranscript((t) => [
                  ...t,
                  {
                    id: `u-${Date.now()}-${Math.random()}`,
                    speaker: 'user',
                    text: evt.text,
                    isRussian: looksRussian(evt.text),
                  },
                ]);
              }
              break;
            case 'tutor_speaking_started':
              setStatus('speaking');
              setTutorPartial('');
              break;
            case 'tutor_transcript_delta':
              setTutorPartial((s) => s + evt.text);
              break;
            case 'tutor_transcript_done':
              if (evt.text.trim()) {
                setTranscript((t) => [
                  ...t,
                  {
                    id: `t-${Date.now()}-${Math.random()}`,
                    speaker: 'tutor',
                    text: evt.text,
                    isRussian: looksRussian(evt.text),
                  },
                ]);
              }
              setTutorPartial('');
              break;
            case 'tutor_speaking_stopped':
              setStatus('listening');
              break;
            case 'error':
              setErrorMsg(evt.message);
              if (!evt.recoverable) setStatus('error');
              break;
            case 'closed':
              setStatus('closed');
              break;
          }
        });

        await session.start();

        // Hard cap — auto-end after HARD_TIMEOUT_MS.
        timeoutId = setTimeout(() => {
          session.stop();
        }, HARD_TIMEOUT_MS);

        return () => {
          off();
        };
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (sessionRef.current) sessionRef.current.stop();
    };
  }, [scenarioId]);

  const statusText: Record<CallStatus, string> = {
    minting: 'Connecting…',
    connecting: 'Connecting…',
    listening: muted ? 'Muted' : 'Listening',
    speaking: 'Sveta speaking',
    error: 'Error',
    closed: 'Call ended',
  };

  const orbActive = status === 'speaking';

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-navy-900 px-6 py-10">
      {/* Hidden audio sink — playsInline is critical for iOS Safari */}
      <audio ref={audioRef} playsInline />

      <div className="w-full text-center">
        <p className="text-xs uppercase tracking-wider text-text-mute">{scenarioTitle}</p>
        <p className="mt-1 text-sm text-white/70">{statusText[status]}</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-8">
        <div
          className={`relative h-44 w-44 rounded-full bg-gradient-to-br from-accent-blue/80 to-purple-500/80 transition-transform duration-500 ${
            orbActive ? 'scale-110 animate-pulse' : 'scale-100'
          }`}
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-full bg-white/10 backdrop-blur" />
        </div>

        {/* Live transcript: latest 4 lines */}
        <div className="mt-2 w-full max-w-md text-center text-sm">
          {tutorPartial && status === 'speaking' && (
            <p className="mb-2 italic text-white/60">{tutorPartial}</p>
          )}
          {transcript.slice(-4).map((line) => (
            <p
              key={line.id}
              className={`mb-2 ${
                line.speaker === 'tutor' ? 'text-white/85' : 'text-white/55'
              } ${line.isRussian ? 'font-semibold' : 'italic'}`}
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
          onClick={() => {
            const next = !muted;
            setMuted(next);
            sessionRef.current?.setMuted(next);
          }}
          disabled={status === 'closed' || status === 'error'}
          className="rounded-xl border border-white/20 px-6 py-3 text-sm text-white/80 disabled:opacity-40"
        >
          {muted ? '🎙️ Unmute' : '🔇 Mute'}
        </button>
        <button
          type="button"
          onClick={() => {
            sessionRef.current?.stop();
            onExit();
          }}
          className="rounded-xl bg-red-500/90 px-6 py-4 text-base font-semibold text-white transition hover:bg-red-500"
        >
          End call
        </button>
      </div>
    </div>
  );
}
