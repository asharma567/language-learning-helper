import { useEffect, useMemo, useRef, useState } from 'react';
import { lexicon } from '../lib/lexicon';
import {
  SessionManager,
  type GlobalStats,
  type SessionItem,
} from '../lib/session';
import { speak, stopSpeaking } from '../lib/tts';
import { startRecording, type Recorder } from '../lib/recorder';
import { gradeTranscript, type GradeResult } from '../lib/grader';
import PhoneticCard from './PhoneticCard';
import ScoreFeedback from './ScoreFeedback';

type Mode = 'study' | 'drive';
type Phase = 'idle' | 'intro' | 'ready' | 'recording' | 'grading' | 'reveal';

type SessionStats = {
  attempted: number;
  advanced: number;
  newSeen: number;
  startedAt: number;
};

const emptySessionStats = (): SessionStats => ({
  attempted: 0,
  advanced: 0,
  newSeen: 0,
  startedAt: Date.now(),
});

export default function Lesson() {
  const manager = useMemo(() => new SessionManager(lexicon), []);
  const [mode, setMode] = useState<Mode>('study');
  const [queue, setQueue] = useState<SessionItem[]>(() => manager.buildQueue());
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GradeResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<GlobalStats>(() => manager.getStats());
  const [sessionStats, setSessionStats] = useState<SessionStats>(() =>
    emptySessionStats(),
  );
  const recorderRef = useRef<Recorder | null>(null);

  const current: SessionItem | undefined = queue[index];
  const sessionDone = !current && queue.length > 0;
  const nothingToDo = !current && queue.length === 0;

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
      setStats(manager.getStats());
      setSessionStats((s) => ({
        ...s,
        attempted: s.attempted + 1,
        advanced: s.advanced + (grade.score === 1 ? 1 : 0),
        newSeen: s.newSeen + (current.isNew ? 1 : 0),
      }));
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
      setIndex(queue.length); // triggers sessionDone branch
    }
  }

  function startNewSession() {
    const next = manager.buildQueue();
    setQueue(next);
    setIndex(0);
    setSessionStats(emptySessionStats());
    setResult(null);
    setErrMsg(null);
    setPhase('idle');
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-neutral-100">
      <StatsStrip stats={stats} />

      {sessionDone || nothingToDo ? (
        <EndScreen
          stats={stats}
          sessionStats={sessionStats}
          completed={sessionDone}
          onStartAnother={startNewSession}
        />
      ) : (
        <SessionView
          mode={mode}
          setMode={setMode}
          queue={queue}
          index={index}
          phase={phase}
          result={result}
          errMsg={errMsg}
          current={current!}
          startRec={startRec}
          stopRec={stopRec}
          retry={() => promptRecall(current!)}
          advance={advance}
        />
      )}
    </div>
  );
}

function StatsStrip({ stats }: { stats: GlobalStats }) {
  const pct = Math.round((stats.introduced / stats.totalEntries) * 100);
  return (
    <div className="border-b border-neutral-900 bg-neutral-950 px-4 py-2">
      <div className="mx-auto flex max-w-2xl items-center justify-between text-xs text-neutral-400">
        <div className="font-mono">
          <span className="text-neutral-100">{stats.introduced}</span>
          <span className="text-neutral-500">/{stats.totalEntries}</span>
          <span className="ml-1">introduced</span>
          <span className="ml-1 text-neutral-600">({pct}%)</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span>
            <span className="text-emerald-400">{stats.mastered}</span> mastered
          </span>
          <span>
            <span className="text-amber-400">🔥 {stats.streak}</span>
          </span>
        </div>
      </div>
      <div className="mx-auto mt-1 h-1 max-w-2xl overflow-hidden rounded-full bg-neutral-900">
        <div
          className="h-full bg-gradient-to-r from-emerald-700 to-emerald-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SessionView({
  mode,
  setMode,
  queue,
  index,
  phase,
  result,
  errMsg,
  current,
  startRec,
  stopRec,
  retry,
  advance,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  queue: SessionItem[];
  index: number;
  phase: Phase;
  result: GradeResult | null;
  errMsg: string | null;
  current: SessionItem;
  startRec: () => void;
  stopRec: () => void;
  retry: () => void;
  advance: () => void;
}) {
  const showCard = mode === 'study' || phase === 'reveal' || current.isNew;
  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-6 p-4">
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
              onClick={retry}
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
          <div className="text-sm text-neutral-500">Introducing new item…</div>
        )}
      </footer>
    </div>
  );
}

function EndScreen({
  stats,
  sessionStats,
  completed,
  onStartAnother,
}: {
  stats: GlobalStats;
  sessionStats: SessionStats;
  completed: boolean;
  onStartAnother: () => void;
}) {
  const accuracy =
    sessionStats.attempted === 0
      ? 0
      : Math.round((sessionStats.advanced / sessionStats.attempted) * 100);
  const minutes = Math.max(
    1,
    Math.round((Date.now() - sessionStats.startedAt) / 60_000),
  );
  const introducedPct = Math.round(
    (stats.introduced / stats.totalEntries) * 100,
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center">
          <div className="text-3xl font-semibold">
            {completed ? 'Session complete' : "You're caught up"}
          </div>
          <div className="mt-2 text-sm text-neutral-400">
            {completed
              ? `${minutes} min · ${sessionStats.attempted} attempts`
              : 'Nothing due right now. Start another batch to introduce more items.'}
          </div>
        </div>

        {completed && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
            <div className="mb-4 text-xs uppercase tracking-wider text-neutral-500">
              This session
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <Stat label="new" value={sessionStats.newSeen} accent="emerald" />
              <Stat label="advanced" value={sessionStats.advanced} accent="emerald" />
              <Stat label="accuracy" value={`${accuracy}%`} accent="amber" />
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
          <div className="mb-4 text-xs uppercase tracking-wider text-neutral-500">
            Overall
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat
              label={`/ ${stats.totalEntries} introduced`}
              value={`${stats.introduced}`}
              accent="neutral"
              footnote={`${introducedPct}%`}
            />
            <Stat label="mastered" value={stats.mastered} accent="emerald" />
            <Stat
              label="day streak"
              value={`🔥 ${stats.streak}`}
              accent="amber"
            />
          </div>
        </div>

        <CategoryBreakdown perCategory={stats.perCategory} />

        <button
          className="w-full rounded-full bg-emerald-600 py-5 text-xl font-semibold"
          onClick={onStartAnother}
        >
          Start another session
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  footnote,
}: {
  label: string;
  value: number | string;
  accent: 'neutral' | 'emerald' | 'amber';
  footnote?: string;
}) {
  const color =
    accent === 'emerald'
      ? 'text-emerald-400'
      : accent === 'amber'
        ? 'text-amber-400'
        : 'text-neutral-100';
  return (
    <div>
      <div className={`text-3xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{label}</div>
      {footnote && (
        <div className="text-xs text-neutral-600">{footnote}</div>
      )}
    </div>
  );
}

function CategoryBreakdown({
  perCategory,
}: {
  perCategory: GlobalStats['perCategory'];
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
      <div className="mb-3 text-xs uppercase tracking-wider text-neutral-500">
        By category
      </div>
      <div className="space-y-2">
        {perCategory.map((c) => {
          const pct = Math.round((c.introduced / c.total) * 100);
          return (
            <div key={c.category} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="capitalize text-neutral-200">
                  {c.category}
                </span>
                <span className="font-mono text-xs text-neutral-500">
                  {c.introduced}/{c.total}
                  {c.mastered > 0 && (
                    <span className="ml-1 text-emerald-400">
                      ·{c.mastered}★
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-900">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
