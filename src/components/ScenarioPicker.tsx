import { useMemo } from 'react';
import { lexicon } from '../lib/lexicon';
import { SCENARIOS } from '../lib/scenarios';
import { SessionManager, type ScenarioStats } from '../lib/session';
import type { ScenarioId } from '../lib/lexicon';

type Props = {
  onSelectScenario: (id: ScenarioId, title: string) => void;
  onSelectQuickMatch: (id: ScenarioId, title: string) => void;
};

export default function ScenarioPicker({ onSelectScenario, onSelectQuickMatch }: Props) {
  const manager = useMemo(() => new SessionManager(lexicon), []);
  const stats = useMemo(() => manager.getStats(), [manager]);

  const isFirstTime = stats.introduced === 0;
  const scenarioMap = new Map<ScenarioId, ScenarioStats>(
    stats.perScenario.map((s) => [s.scenarioId, s]),
  );

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top strip */}
      <header className="flex items-center justify-end px-4 pt-6 pb-2">
        <span className="text-xs text-text-mute">
          🔥 {stats.streak} &nbsp;·&nbsp; {stats.mastered} mastered
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-8">
        <h1 className="mb-1 text-2xl font-semibold text-white">Choose a scenario</h1>
        <p className="mb-6 text-sm text-text-mute">Tap a card to start your session.</p>

        <div className="space-y-3">
          {SCENARIOS.map((scenario) => {
            const s = scenarioMap.get(scenario.id);
            const introduced = s?.introduced ?? 0;
            const total = s?.total ?? 0;
            const due = s?.due ?? 0;
            const pct = total > 0 ? Math.round((introduced / total) * 100) : 0;
            const canQuickMatch = introduced >= 4;
            const isRecommended = scenario.defaultRecommended && isFirstTime;

            const perLesson = s?.perLesson ?? [];
            const lessonCount = perLesson.length;
            const lessonsComplete = perLesson.filter(
              (l) => l.total > 0 && l.mastered === l.total,
            ).length;

            return (
              <div
                key={scenario.id}
                className={`rounded-2xl bg-navy-700 p-5 flex flex-col gap-2 ${
                  isRecommended ? 'ring-2 ring-accent' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="flex-1 text-left"
                    onClick={() => onSelectScenario(scenario.id, scenario.title)}
                    aria-label={`Open ${scenario.title} lessons`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-semibold text-white">
                        {scenario.title}
                      </span>
                      {isRecommended && (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-white">
                          Start here
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-text-mute">{scenario.description}</p>
                  </button>

                  {canQuickMatch && (
                    <button
                      onClick={() => onSelectQuickMatch(scenario.id, scenario.title)}
                      aria-label={`Quick Match for ${scenario.title}`}
                      className="flex-shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-xs text-accent"
                    >
                      Quick Match
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-mute">
                    {introduced} / {total} introduced
                    {' · '}
                    {lessonsComplete} / {lessonCount} lessons complete
                  </span>
                  {due > 0 && (
                    <span
                      aria-label={`${due} items due`}
                      className="h-2 w-2 rounded-full bg-amber-400"
                    />
                  )}
                </div>

                {/* progress bar */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
