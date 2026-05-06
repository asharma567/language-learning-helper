// Pre-call screen for the AI voice tutor.
// Two responsibilities:
//   1. Let the user pick which scenario the tutor will drill from.
//   2. Provide the user gesture (button click) that starts the call. This
//      gesture is critical on iOS Safari — both AudioContext creation and
//      the first <audio>.play() must happen inside this click handler.

import { useMemo, useState } from 'react';
import { SCENARIOS } from '../lib/scenarios';
import type { ScenarioId } from '../lib/lexicon';

type Props = {
  onCancel: () => void;
  onStart: (scenarioId: ScenarioId, scenarioTitle: string) => void;
};

export default function TutorCallSetup({ onCancel, onStart }: Props) {
  const orderedScenarios = useMemo(
    () => [...SCENARIOS].sort((a, b) => a.order - b.order),
    [],
  );
  const [scenarioId, setScenarioId] = useState<ScenarioId>(
    orderedScenarios[0].id,
  );
  const scenarioTitle =
    orderedScenarios.find((s) => s.id === scenarioId)?.title ?? 'Russian';

  return (
    <div className="flex min-h-screen flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-xl flex-1 flex flex-col">
        <button
          type="button"
          onClick={onCancel}
          className="mb-6 self-start text-sm text-text-mute hover:text-white"
        >
          ← Back
        </button>

        <div className="flex-1">
          <h1 className="mb-2 text-3xl font-semibold">Talk to a tutor</h1>
          <p className="mb-8 text-text-mute">
            Live voice call with Sveta — a patient native Russian speaker. She'll drill phrases from the scenario you pick, in Russian and English.
          </p>

          <label className="mb-2 block text-sm text-text-mute">
            Scenario to drill
          </label>
          <select
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value as ScenarioId)}
            className="mb-6 w-full rounded-xl border border-white/10 bg-navy-700 p-4 text-base text-white focus:border-accent-blue focus:outline-none"
          >
            {orderedScenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>

          <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-xs text-amber-200/80">
            <p className="font-semibold mb-1">Heads up</p>
            <ul className="list-disc pl-4 space-y-1 text-amber-200/70">
              <li>Calls cost ~$0.15/minute. Auto-end at 10 minutes.</li>
              <li>Allow microphone access when your browser asks.</li>
              <li>Tap "End call" any time.</li>
            </ul>
          </div>
        </div>

        <button
          type="button"
          // CRITICAL: this onClick is the user gesture chain that lets the
          // tutor session create an AudioContext and call audio.play() on iOS.
          onClick={() => onStart(scenarioId, scenarioTitle)}
          className="rounded-xl bg-accent-blue px-6 py-5 text-lg font-semibold text-white transition hover:opacity-90 active:opacity-80"
        >
          🎙️ Start call
        </button>
      </div>
    </div>
  );
}
