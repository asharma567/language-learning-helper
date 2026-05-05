import { useState } from 'react';
import ScenarioPicker from './ScenarioPicker';
import LessonPicker from './LessonPicker';
import Lesson from './Lesson';
import QuickMatch from './QuickMatch';
import CustomPhraseEntry from './CustomPhraseEntry';
import type { LexiconEntry, ScenarioId } from '../lib/lexicon';

type Screen =
  | { name: 'picker' }
  | { name: 'lessonpicker'; scenarioId: ScenarioId; scenarioTitle: string; justCompletedLesson?: number }
  | { name: 'lesson'; scenarioId: ScenarioId; scenarioTitle: string; lessonNumber: number }
  | { name: 'quickmatch'; scenarioId: ScenarioId; scenarioTitle: string }
  | { name: 'customphrase' }
  | { name: 'customlesson'; entry: LexiconEntry };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'picker' });

  if (screen.name === 'picker') {
    return (
      <ScenarioPicker
        onSelectScenario={(id, title) =>
          setScreen({ name: 'lessonpicker', scenarioId: id, scenarioTitle: title })
        }
        onSelectQuickMatch={(id, title) =>
          setScreen({ name: 'quickmatch', scenarioId: id, scenarioTitle: title })
        }
        onSelectCustomPhrase={() => setScreen({ name: 'customphrase' })}
      />
    );
  }

  if (screen.name === 'customphrase') {
    return (
      <CustomPhraseEntry
        onReady={(entry) => setScreen({ name: 'customlesson', entry })}
        onCancel={() => setScreen({ name: 'picker' })}
      />
    );
  }

  if (screen.name === 'customlesson') {
    return (
      <Lesson
        customEntries={[screen.entry]}
        scenarioTitle="Custom phrase"
        onExit={() => setScreen({ name: 'picker' })}
        onLessonComplete={() => setScreen({ name: 'picker' })}
      />
    );
  }

  if (screen.name === 'lessonpicker') {
    return (
      <LessonPicker
        scenarioId={screen.scenarioId}
        scenarioTitle={screen.scenarioTitle}
        justCompletedLesson={screen.justCompletedLesson}
        onSelectLesson={(lessonNumber) =>
          setScreen({
            name: 'lesson',
            scenarioId: screen.scenarioId,
            scenarioTitle: screen.scenarioTitle,
            lessonNumber,
          })
        }
        onBack={() => setScreen({ name: 'picker' })}
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
            name: 'lessonpicker',
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
      lessonNumber={screen.lessonNumber}
      onExit={() => setScreen({ name: 'picker' })}
      onLessonComplete={() =>
        setScreen({
          name: 'lessonpicker',
          scenarioId: screen.scenarioId,
          scenarioTitle: screen.scenarioTitle,
          justCompletedLesson: screen.lessonNumber,
        })
      }
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
