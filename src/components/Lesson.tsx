import { useEffect, useMemo, useRef, useState } from 'react';
import { lexicon, type LexiconEntry } from '../lib/lexicon';
import { SessionManager, type SessionItem } from '../lib/session';
import { speak, stopSpeaking } from '../lib/tts';
import { startRecording, type Recorder } from '../lib/recorder';
import { gradeTranscript, type GradeResult } from '../lib/grader';
import PhoneticCard from './PhoneticCard';
import ScoreFeedback from './ScoreFeedback';

type Mode = 'study' | 'drive';
type Phase = 'idle' | 'intro' | 'ready' | 'recording' | 'grading' | 'reveal';

export default function Lesson() {
  const manager = useMemo(() => new SessionManager(lexicon), []);
  const [mode, setMode] = useState<Mode>('study');
  const [queue, setQueue] = useState<SessionItem[]>(() => manager.buildQueue(5));
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GradeResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);

  const current: SessionItem | undefined = queue[index];

  useEffect(() => () => stopSpeaking(), []);

  async function introduceItem(item: SessionItem) {
    setPhase('intro');
    setResult(null);
    setErrMsg(null);
    await speak(item.entry.en, { lang: 'en-US' });
    await wait(300);
    await speak(item.entry.ru, { lang: 'ru-RU' });
    await wait(300);
    await speak(item.entry.ru, { lang: 'ru-RU' });
    setPhase('ready');
  }

  async function promptRecall(item: SessionItem) {
    setPhase('ready');
    setResult(null);
    setErrMsg(null);
    await speak(item.entry.en, { lang: 'en-US' });
  }

  async function beginItem(item: SessionItem) {
    if (item.isNew) await introduceItem(item);
    else await promptRecall(item);
  }

  useEffect(() => {
    if (!current) return;
    beginItem(current).catch((e) => setErrMsg(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function startRec() {
    setErrMsg(null);
    try {
      recorderRef.current = await startRecording();
      setPhase('recording');
    } catch (e) {
      setErrMsg(`Mic failed: ${String(e)}`);
    }
  }

  async function stopRec() {
    if (!recorderRef.current || !current) return;
    setPhase('grading');
    try {
      const blob = await recorderRef.current.stop();
      recorderRef.current = null;
      const fd = new FormData();
      fd.append('audio', blob, 'attempt.webm');
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`transcribe ${res.status}`);
      const data = (await res.json()) as { text: string; confidence: number | null };
      const grade = gradeTranscript(
        current.entry.ru,
        data.text,
        data.confidence,
        current.entry.accepts ?? [],
      );
      setResult(grade);
      manager.recordAttempt(current.entry.id, grade.score);
      setPhase('reveal');
      await speak(current.entry.ru, { lang: 'ru-RU' });
    } catch (e) {
      setErrMsg(`Grade failed: ${String(e)}`);
      setPhase('ready');
    }
  }

  function advance() {
    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      const next = manager.buildQueue(5);
      setQueue(next);
      setIndex(0);
    }
  }

  function rebuild() {
    setQueue(manager.buildQueue(5));
    setIndex(0);
  }

  if (!current) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-neutral-200">
        <div className="text-center">
          <div className="mb-4 text-xl">Nothing due right now.</div>
          <button
            className="rounded-full bg-emerald-600 px-6 py-3"
            onClick={rebuild}
          >
            Rebuild queue
          </button>
        </div>
      </div>
    );
  }

  const showCard = mode === 'study' || phase === 'reveal' || current.isNew;

  return (
    <div className="flex min-h-screen flex-col items-center justify-between gap-6 bg-black p-4 text-neutral-100">
      <header className="flex w-full max-w-2xl items-center justify-between">
        <div className="text-sm text-neutral-400">
          {index + 1} / {queue.length} · L{current.state.level}
          {current.isNew && <span className="ml-2 text-emerald-400">NEW</span>}
        </div>
        <button
          className="rounded-full border border-neutral-700 px-3 py-1 text-xs uppercase tracking-wider"
          onClick={() => setMode(mode === 'study' ? 'drive' : 'study')}
        >
          {mode}
        </button>
      </header>

      <main className="flex w-full flex-1 flex-col items-center justify-center gap-6">
        {showCard ? (
          <PhoneticCard
            entry={current.entry}
            wrongWordIndices={result?.wrongWordIndices}
            showEnglish
          />
        ) : (
          <div className="text-center text-3xl text-neutral-300">
            {phase === 'ready' && 'Listen, then speak.'}
            {phase === 'recording' && 'Listening…'}
            {phase === 'grading' && 'Grading…'}
          </div>
        )}
        <ScoreFeedback result={result} />
        {errMsg && <div className="text-sm text-red-400">{errMsg}</div>}
      </main>

      <footer className="flex w-full max-w-2xl flex-col items-center gap-3 pb-6">
        {phase === 'ready' && (
          <button
            className="w-full rounded-full bg-emerald-600 py-5 text-xl font-semibold"
            onClick={startRec}
          >
            Tap and speak
          </button>
        )}
        {phase === 'recording' && (
          <button
            className="w-full rounded-full bg-red-600 py-5 text-xl font-semibold"
            onClick={stopRec}
          >
            Stop
          </button>
        )}
        {phase === 'grading' && (
          <button className="w-full rounded-full bg-neutral-800 py-5 text-xl" disabled>
            Grading…
          </button>
        )}
        {phase === 'reveal' && (
          <div className="flex w-full gap-3">
            <button
              className="flex-1 rounded-full border border-neutral-700 py-4"
              onClick={() => promptRecall(current)}
            >
              Retry
            </button>
            <button
              className="flex-1 rounded-full bg-emerald-600 py-4 font-semibold"
              onClick={advance}
            >
              Next
            </button>
          </div>
        )}
        {phase === 'intro' && (
          <div className="text-sm text-neutral-500">
            Introducing new item…
          </div>
        )}
      </footer>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
