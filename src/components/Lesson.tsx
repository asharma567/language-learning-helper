import { useEffect, useMemo, useRef, useState } from 'react';
import { lexicon, type LexiconEntry, type ScenarioId } from '../lib/lexicon';
import {
  SessionManager,
  type GlobalStats,
  type SessionItem,
} from '../lib/session';
import { newItem } from '../lib/srs';
import { speak, stopSpeaking } from '../services/tts';
import { startRecording, type Recorder } from '../lib/recorder';
import { assessPronunciation } from '../services/pronunciation';
import { gradeFromAzure, type GradeResult } from '../lib/grader';
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

type Props = {
  scenarioId?: ScenarioId;
  scenarioTitle?: string;
  lessonNumber?: number;
  /**
   * Ad-hoc one-off items (e.g. user-typed custom phrases). When provided,
   * the queue is built from these directly and SRS state is NOT persisted.
   */
  customEntries?: LexiconEntry[];
  onExit?: () => void;
  onLessonComplete?: () => void;
  onQuickMatch?: () => void;
};

const isCustomEntry = (id: string): boolean => id.startsWith('custom-');

export default function Lesson({ scenarioId, scenarioTitle, lessonNumber, customEntries, onExit, onLessonComplete, onQuickMatch }: Props) {
  const manager = useMemo(() => new SessionManager(lexicon), []);
  const [mode, setMode] = useState<Mode>('study');
  const [queue, setQueue] = useState<SessionItem[]>(() => {
    if (customEntries && customEntries.length) {
      return customEntries.map((entry) => ({
        entry,
        state: newItem(entry.id),
        isNew: true,
      }));
    }
    if (scenarioId && lessonNumber !== undefined) {
      return manager.buildLessonQueue(scenarioId, lessonNumber);
    }
    if (scenarioId) return manager.buildScenarioQueue(scenarioId);
    return manager.buildQueue();
  });
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GradeResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<GlobalStats>(() => manager.getStats());
  const [sessionStats, setSessionStats] = useState<SessionStats>(() =>
    emptySessionStats(),
  );
  const [failCounts, setFailCounts] = useState<Record<string, number>>({});
  const [driveModeSeen, setDriveModeSeen] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('driveModeSeen') === '1',
  );
  const recorderRef = useRef<Recorder | null>(null);

  const current: SessionItem | undefined = queue[index];
  const sessionDone = !current && queue.length > 0;
  const nothingToDo = !current && queue.length === 0;

  const currentFails = current ? (failCounts[current.entry.id] ?? 0) : 0;
  const showThreeFailHint = phase === 'reveal' && currentFails >= 3;

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
      const rawBlob = await recorderRef.current.stop();
      recorderRef.current = null;
      const assessment = await assessPronunciation(rawBlob, current.entry.ru);
      const grade = gradeFromAzure(current.entry.ru, assessment);
      setResult(grade);
      // Custom one-off entries aren't in the SRS lexicon — skip persistence.
      if (!isCustomEntry(current.entry.id)) {
        manager.recordAttempt(current.entry.id, grade.score);
        setStats(manager.getStats());
      }
      setSessionStats((s) => ({
        ...s,
        attempted: s.attempted + 1,
        advanced: s.advanced + (grade.score === 1 ? 1 : 0),
        newSeen: s.newSeen + (current.isNew ? 1 : 0),
      }));
      if (grade.score < 0.9) {
        setFailCounts((fc) => ({
          ...fc,
          [current.entry.id]: (fc[current.entry.id] ?? 0) + 1,
        }));
      }
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
      setIndex(queue.length);
    }
  }

  function startNewSession() {
    let next: SessionItem[];
    if (scenarioId && lessonNumber !== undefined) {
      next = manager.buildLessonQueue(scenarioId, lessonNumber);
    } else if (scenarioId) {
      next = manager.buildScenarioQueue(scenarioId);
    } else {
      next = manager.buildQueue();
    }
    setQueue(next);
    setIndex(0);
    setSessionStats(emptySessionStats());
    setResult(null);
    setErrMsg(null);
    setPhase('idle');
    setFailCounts({});
  }

  function activateDriveMode() {
    setMode('drive');
    if (!driveModeSeen) {
      setDriveModeSeen(true);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('driveModeSeen', '1');
      }
    }
  }

  const scenarioStats = scenarioId
    ? stats.perScenario?.find((s) => s.scenarioId === scenarioId)
    : undefined;
  const scenarioIntroduced = scenarioStats?.introduced ?? 0;
  const scenarioComplete =
    !!scenarioStats &&
    scenarioStats.total > 0 &&
    scenarioStats.mastered === scenarioStats.total;

  const isLessonMode = scenarioId !== undefined && lessonNumber !== undefined;
  const lessonDone = (sessionDone || nothingToDo) && isLessonMode && !scenarioComplete;

  useEffect(() => {
    if (lessonDone) onLessonComplete?.();
  }, [lessonDone]);

  return (
    <div className="flex min-h-screen flex-col">
      {sessionDone || nothingToDo ? (
        <EndScreen
          stats={stats}
          sessionStats={sessionStats}
          completed={sessionDone}
          scenarioTitle={scenarioTitle}
          scenarioIntroduced={scenarioIntroduced}
          scenarioComplete={scenarioComplete}
          onStartAnother={startNewSession}
          onChangeScenario={onExit}
          onQuickMatch={() => onQuickMatch?.()}
        />
      ) : (
        <SessionView
          mode={mode}
          setMode={(m) => { if (m === 'drive') activateDriveMode(); else setMode(m); }}
          driveModeSeen={driveModeSeen}
          queue={queue}
          index={index}
          phase={phase}
          result={result}
          errMsg={errMsg}
          current={current!}
          scenarioTitle={scenarioTitle ?? 'Russian'}
          showThreeFailHint={showThreeFailHint}
          startRec={startRec}
          stopRec={stopRec}
          retry={() => promptRecall(current!)}
          advance={advance}
          onExit={onExit}
        />
      )}
    </div>
  );
}

// ── Circular Hero ────────────────────────────────────────────────────────────

const HERO_SIZE = 280;
const RING_R = 126;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

function CircularHero({
  entry,
  index,
  total,
  phase,
  ringWrong,
  onPlayRussian,
  onPlaySlow,
}: {
  entry: SessionItem['entry'];
  index: number;
  total: number;
  phase: Phase;
  ringWrong: boolean;
  onPlayRussian: () => void;
  onPlaySlow: () => void;
}) {
  const fillFraction = total > 0 ? (index + 1) / total : 0;
  const fillDash = fillFraction * CIRCUMFERENCE;
  const ringStroke = ringWrong ? 'stroke-arc-wrong' : 'stroke-arc-progress';
  const playDisabled = phase === 'recording' || phase === 'grading' || phase === 'intro';

  return (
    <div
      className="relative mx-auto flex-shrink-0"
      style={{ width: HERO_SIZE, height: HERO_SIZE }}
    >
      <svg
        width={HERO_SIZE}
        height={HERO_SIZE}
        className="-rotate-90"
        aria-hidden="true"
      >
        {/* track */}
        <circle
          cx={HERO_SIZE / 2}
          cy={HERO_SIZE / 2}
          r={RING_R}
          fill="none"
          strokeWidth={8}
          className="stroke-arc-new"
          opacity={0.4}
        />
        {/* fill */}
        <circle
          cx={HERO_SIZE / 2}
          cy={HERO_SIZE / 2}
          r={RING_R}
          fill="none"
          strokeWidth={8}
          className={ringStroke}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE - fillDash}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>

      {/* content overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
        <p className="text-center text-3xl font-semibold text-white leading-tight">
          {entry.en}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onPlayRussian}
            disabled={playDisabled}
            aria-label="Play Russian at normal speed"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent disabled:opacity-40"
          >
            <SpeakerIcon />
          </button>
          <button
            onClick={onPlaySlow}
            disabled={playDisabled}
            aria-label="Play Russian slowly (0.75×)"
            title="Slow"
            className="flex h-10 items-center justify-center gap-1 rounded-full border border-white/20 bg-navy-700/60 px-3 text-sm text-white/80 disabled:opacity-40"
          >
            <span aria-hidden="true">🐢</span>
            <span className="font-mono text-xs">0.75×</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Session View ─────────────────────────────────────────────────────────────

function SessionView({
  mode,
  setMode,
  driveModeSeen,
  queue,
  index,
  phase,
  result,
  errMsg,
  current,
  scenarioTitle,
  showThreeFailHint,
  startRec,
  stopRec,
  retry,
  advance,
  onExit,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  driveModeSeen: boolean;
  queue: SessionItem[];
  index: number;
  phase: Phase;
  result: GradeResult | null;
  errMsg: string | null;
  current: SessionItem;
  scenarioTitle: string;
  showThreeFailHint: boolean;
  startRec: () => void;
  stopRec: () => void;
  retry: () => void;
  advance: () => void;
  onExit?: () => void;
}) {
  const [showDriveTip, setShowDriveTip] = useState(false);

  function handleModeToggle() {
    const next = mode === 'study' ? 'drive' : 'study';
    setMode(next);
    if (next === 'drive' && !driveModeSeen) {
      setShowDriveTip(true);
      setTimeout(() => setShowDriveTip(false), 3500);
    }
  }

  const showCard = mode === 'study' || phase === 'reveal' || current.isNew;
  const [ringWrong, setRingWrong] = useState(false);

  useEffect(() => {
    if (result && !result.exact && result.score < 0.9) {
      setRingWrong(true);
      const t = setTimeout(() => setRingWrong(false), 600);
      return () => clearTimeout(t);
    }
  }, [result]);

  const title =
    scenarioTitle.length > 20
      ? scenarioTitle.slice(0, 19) + '…'
      : scenarioTitle;

  return (
    <div className="flex flex-1 flex-col">
      {/* Top header */}
      <header className="flex h-11 w-full items-center justify-between px-4">
        <button
          onClick={onExit}
          aria-label="Exit to scenario picker"
          className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70"
        >
          Exit
        </button>
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="font-mono text-xs text-text-mute">
          {index + 1}&thinsp;/&thinsp;{queue.length}
        </span>
      </header>

      {/* Mode toggle */}
      <div className="flex justify-end px-4 pt-1">
        <button
          onClick={handleModeToggle}
          aria-label={`Switch to ${mode === 'study' ? 'drive' : 'study'} mode`}
          className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/60"
        >
          {mode === 'study' ? 'Study' : 'Drive'}
        </button>
      </div>

      {showDriveTip && (
        <div className="mx-4 mt-2 rounded-xl border border-white/10 bg-navy-700 px-4 py-2 text-xs text-text-mute">
          Drive mode hides the text — rely on your ears.
        </div>
      )}

      {/* Main content */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-4">
        <CircularHero
          entry={current.entry}
          index={index}
          total={queue.length}
          phase={phase}
          ringWrong={ringWrong}
          onPlayRussian={() => speak(current.entry.ru, { lang: 'ru-RU' })}
          onPlaySlow={() => speak(current.entry.ru, { lang: 'ru-RU', rate: 0.75 })}
        />

        {showCard && (
          <PhoneticCard
            entry={current.entry}
            wrongWordIndices={result?.wrongWordIndices}
            showEnglish={false}
          />
        )}

        {!showCard && (
          <div className="text-center text-2xl text-white/50">
            {phase === 'ready' && 'Listen, then speak.'}
            {phase === 'recording' && 'Listening…'}
            {phase === 'grading' && 'Grading…'}
          </div>
        )}

        <ScoreFeedback result={result} targetDisplay={current.entry.ru} />

        {showThreeFailHint && (
          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-navy-700 p-4">
            <div className="flex items-start gap-3">
              <span className="text-lg" aria-hidden="true">🐢</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">Let's slow down</p>
                <p className="mt-0.5 text-xs text-text-mute">
                  Repeat after the audio. No pressure to record.
                </p>
                <button
                  onClick={() => speak(current.entry.ru, { lang: 'ru-RU', rate: 0.75 })}
                  className="mt-3 rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70"
                >
                  Hear it slowly
                </button>
              </div>
            </div>
          </div>
        )}

        {errMsg && <div className="text-sm text-red-400">{errMsg}</div>}

        {current.isNew && phase !== 'intro' && (
          <span className="rounded-full bg-accent/20 px-3 py-1 text-xs text-accent">
            NEW
          </span>
        )}
      </main>

      {/* Footer action buttons */}
      <footer className="flex w-full flex-col items-center gap-3 px-4 pb-8">
        {phase === 'intro' && (
          <p className="text-sm text-text-mute">Introducing…</p>
        )}
        {phase === 'ready' && (
          <button
            className="w-full max-w-2xl rounded-full bg-accent py-5 text-xl font-semibold text-white"
            onClick={startRec}
            aria-label="Record your pronunciation"
          >
            Tap and speak
          </button>
        )}
        {phase === 'recording' && (
          <button
            className="w-full max-w-2xl rounded-full bg-red-500 py-5 text-xl font-semibold text-white"
            onClick={stopRec}
          >
            Stop
          </button>
        )}
        {phase === 'grading' && (
          <button
            className="w-full max-w-2xl rounded-full bg-navy-700 py-5 text-xl opacity-50"
            disabled
          >
            Grading…
          </button>
        )}
        {phase === 'reveal' && (
          <div className="flex w-full max-w-2xl gap-3">
            <button
              className="flex-1 rounded-full border border-white/20 py-4 text-white/70"
              onClick={retry}
            >
              Retry
            </button>
            <button
              className="flex-1 rounded-full bg-accent py-4 font-semibold text-white"
              onClick={advance}
            >
              Next
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

// ── End Screen ───────────────────────────────────────────────────────────────

function EndScreen({
  stats,
  sessionStats,
  completed,
  scenarioTitle,
  scenarioIntroduced,
  scenarioComplete,
  onStartAnother,
  onChangeScenario,
  onQuickMatch,
}: {
  stats: GlobalStats;
  sessionStats: SessionStats;
  completed: boolean;
  scenarioTitle?: string;
  scenarioIntroduced: number;
  scenarioComplete: boolean;
  onStartAnother: () => void;
  onChangeScenario?: () => void;
  onQuickMatch: () => void;
}) {
  const accuracy =
    sessionStats.attempted === 0
      ? 0
      : Math.round((sessionStats.advanced / sessionStats.attempted) * 100);
  const minutes = Math.max(
    1,
    Math.round((Date.now() - sessionStats.startedAt) / 60_000),
  );

  const title = scenarioComplete
    ? 'Scenario complete'
    : completed
      ? 'Session complete'
      : "You're caught up";

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <div className="text-3xl font-semibold text-white">{title}</div>
          <div className="mt-2 text-sm text-text-mute">
            {completed
              ? `${minutes} min · ${sessionStats.attempted} attempts`
              : 'Nothing due right now. Start another batch to introduce more items.'}
          </div>
        </div>

        {completed && (
          <div className="rounded-2xl border border-white/10 bg-navy-700 p-6">
            <div className="mb-4 text-xs uppercase tracking-wider text-text-mute">
              This session
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <Stat label="new" value={sessionStats.newSeen} accent="accent" />
              <Stat label="advanced" value={sessionStats.advanced} accent="accent" />
              <Stat label="accuracy" value={`${accuracy}%`} accent="amber" />
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-navy-700 p-6">
          <div className="mb-4 text-xs uppercase tracking-wider text-text-mute">
            Overall
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat
              label={`/ ${stats.totalEntries} introduced`}
              value={`${stats.introduced}`}
              accent="neutral"
            />
            <Stat label="mastered" value={stats.mastered} accent="accent" />
            <Stat
              label="day streak"
              value={`🔥 ${stats.streak}`}
              accent="amber"
            />
          </div>
        </div>

        {scenarioIntroduced >= 4 && (
          <button
            className="w-full rounded-full border-2 border-accent py-4 text-xl font-semibold text-accent"
            aria-label="Play Quick Match"
            onClick={onQuickMatch}
          >
            Play Quick Match
          </button>
        )}

        {scenarioComplete ? (
          <button
            className="w-full rounded-full bg-accent py-5 text-xl font-semibold text-white"
            aria-label="Back to scenarios"
            onClick={onChangeScenario}
          >
            Back to scenarios
          </button>
        ) : (
          <>
            <button
              className="w-full rounded-full bg-accent py-5 text-xl font-semibold text-white"
              aria-label="Start another session"
              onClick={onStartAnother}
            >
              {scenarioTitle ? `More ${scenarioTitle}` : 'Start another session'}
            </button>

            {onChangeScenario && (
              <button
                className="w-full text-center text-sm text-text-mute underline"
                onClick={onChangeScenario}
              >
                Change scenario
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: 'neutral' | 'accent' | 'amber';
}) {
  const color =
    accent === 'accent'
      ? 'text-accent'
      : accent === 'amber'
        ? 'text-amber-400'
        : 'text-white';
  return (
    <div>
      <div className={`text-3xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-text-mute">{label}</div>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5 text-white"
      aria-hidden="true"
    >
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zm4.906 1.694a.75.75 0 011.06 0 8.25 8.25 0 010 11.492.75.75 0 11-1.06-1.06 6.75 6.75 0 000-9.372.75.75 0 010-1.06z" />
      <path d="M18.544 9.772a.75.75 0 011.06 0 4.5 4.5 0 010 6.364.75.75 0 11-1.06-1.06 3 3 0 000-4.243.75.75 0 010-1.061z" />
    </svg>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
