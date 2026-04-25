import { useState } from 'react';
import ScenarioPicker from './ScenarioPicker';
import Lesson from './Lesson';
import QuickMatch from './QuickMatch';
import type { ScenarioId } from '../lib/lexicon';

type Screen =
  | { name: 'picker' }
  | { name: 'lesson'; scenarioId: ScenarioId; scenarioTitle: string }
  | { name: 'quickmatch'; scenarioId: ScenarioId; scenarioTitle: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'picker' });

  if (screen.name === 'picker') {
    return (
      <ScenarioPicker
        onSelectScenario={(id, title) =>
          setScreen({ name: 'lesson', scenarioId: id, scenarioTitle: title })
        }
        onSelectQuickMatch={(id, title) =>
          setScreen({ name: 'quickmatch', scenarioId: id, scenarioTitle: title })
        }
      />
    );
  }

  if (screen.name === 'quickmatch') {
    return (
      <QuickMatch
        scenarioId={screen.scenarioId}
        scenarioTitle={screen.scenarioTitle}
        onExit={() => setScreen({ name: 'picker' })}
        onDone={() =>
          setScreen({
            name: 'lesson',
            scenarioId: screen.scenarioId,
            scenarioTitle: screen.scenarioTitle,
          })
        }
      />
    );
  }

  return (
    <Lesson
      scenarioId={screen.scenarioId}
      scenarioTitle={screen.scenarioTitle}
      onExit={() => setScreen({ name: 'picker' })}
      onQuickMatch={() =>
        setScreen({
          name: 'quickmatch',
          scenarioId: screen.scenarioId,
          scenarioTitle: screen.scenarioTitle,
        })
      }
    />
  );
}
