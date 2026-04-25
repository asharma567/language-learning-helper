import { useEffect, useMemo, useRef, useState } from 'react';
import { lexicon } from '../lib/lexicon';
import { SessionManager } from '../lib/session';
import { pickQuickMatchSet } from '../lib/quickmatch';
import { speak } from '../lib/tts';
import type { LexiconEntry, ScenarioId } from '../lib/lexicon';

type CardState = 'idle' | 'correct' | 'wrong' | 'reveal-correct';

type Props = {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  onExit: () => void;
  onDone: () => void;
};

export default function QuickMatch({ scenarioId, scenarioTitle, onExit, onDone }: Props) {
  const manager = useMemo(() => new SessionManager(lexicon), []);

  const rounds = useMemo(() => {
    const stats = manager.getStats();
    const scenarioStats = stats.perScenario.find((s) => s.scenarioId === scenarioId);
    if (!scenarioStats || scenarioStats.introduced < 4) return [];

    // Build introduced entries for this scenario
    const queue = manager.buildScenarioQueue(scenarioId, 0);
    const introduced = queue
      .filter((item) => item.state.introduced)
      .map((item) => item.entry);

    const shuffled = [...introduced].sort(() => Math.random() - 0.5);
    const targets = shuffled.slice(0, Math.min(10, shuffled.length));

    return targets.map((target) => pickQuickMatchSet(lexicon, target));
  }, [manager, scenarioId]);

  const [roundIndex, setRoundIndex] = useState(0);
  const [cardStates, setCardStates] = useState<CardState[]>(['idle', 'idle', 'idle', 'idle']);
  const [locked, setLocked] = useState(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  if (rounds.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <p className="text-white text-xl text-center">
          Introduce at least 4 items in this scenario before playing Quick Match.
        </p>
        <button
          onClick={onExit}
          className="rounded-full border border-white/20 px-6 py-3 text-sm text-white/70"
        >
          Go back
        </button>
      </div>
    );
  }

  const round = rounds[roundIndex];
  const allChoices: LexiconEntry[] = shuffle([round.target, ...round.distractors]);

  function handleTap(choice: LexiconEntry) {
    if (locked) return;
    setLocked(true);

    speak(choice.ru, { lang: 'ru-RU' });

    const isCorrect = choice.id === round.target.id;

    setCardStates(
      allChoices.map((c) => {
        if (c.id === choice.id) return isCorrect ? 'correct' : 'wrong';
        if (!isCorrect && c.id === round.target.id) return 'reveal-correct';
        return 'idle';
      }),
    );

    manager.recordAttempt(round.target.id, isCorrect ? 0.5 : 0);

    const delay = isCorrect ? 600 : 800;
    advanceTimerRef.current = setTimeout(() => {
      const next = roundIndex + 1;
      if (next >= rounds.length) {
        onDone();
      } else {
        setRoundIndex(next);
        setCardStates(['idle', 'idle', 'idle', 'idle']);
        setLocked(false);
      }
    }, delay);
  }

  const cardBg = (state: CardState) => {
    if (state === 'correct' || state === 'reveal-correct') return 'bg-emerald-500 text-white';
    if (state === 'wrong') return 'bg-red-400 text-white';
    return 'bg-card text-gray-900';
  };

  const title =
    scenarioTitle.length > 20 ? scenarioTitle.slice(0, 19) + '…' : scenarioTitle;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex h-11 w-full items-center justify-between px-4">
        <button
          onClick={onExit}
          aria-label="Exit Quick Match"
          className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70"
        >
          Exit
        </button>
        <span className="text-sm font-semibold text-white">Quick Match</span>
        <span className="font-mono text-xs text-text-mute">
          {roundIndex + 1}&thinsp;/&thinsp;{rounds.length}
        </span>
      </header>

      {/* English prompt */}
      <div className="flex flex-col items-center justify-center px-6 pt-8 pb-6">
        <p className="text-center text-xl font-semibold text-white">
          {round.target.en}
        </p>
      </div>

      {/* Answer cards */}
      <main className="flex flex-1 flex-col gap-3 px-4 pb-8">
        {allChoices.map((choice, i) => (
          <button
            key={choice.id}
            onClick={() => handleTap(choice)}
            disabled={locked}
            aria-label={`Answer: ${choice.phonetic}`}
            className={`w-full rounded-2xl px-4 py-5 flex items-center gap-3 shadow-sm text-lg font-phonetic font-semibold transition-colors ${cardBg(cardStates[i])}`}
          >
            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${cardStates[i] === 'idle' ? 'bg-accent/10 text-accent' : 'bg-white/20 text-white'}`}>
              <SpeakerIcon />
            </span>
            <span>{choice.phonetic}</span>
          </button>
        ))}
      </main>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zm4.906 1.694a.75.75 0 011.06 0 8.25 8.25 0 010 11.492.75.75 0 11-1.06-1.06 6.75 6.75 0 000-9.372.75.75 0 010-1.06z" />
      <path d="M18.544 9.772a.75.75 0 011.06 0 4.5 4.5 0 010 6.364.75.75 0 11-1.06-1.06 3 3 0 000-4.243.75.75 0 010-1.061z" />
    </svg>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
