import { useMemo } from 'react';
import { lexicon } from '../lib/lexicon';
import { SessionManager, type LessonStats } from '../lib/session';
import type { ScenarioId } from '../lib/lexicon';

type Props = {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  justCompletedLesson?: number;
  onSelectLesson: (lessonNumber: number) => void;
  onBack: () => void;
};

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-emerald-400"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function LessonCard({
  lesson,
  isUpNext,
  onSelect,
}: {
  lesson: LessonStats & { title?: string };
  isUpNext: boolean;
  onSelect: () => void;
}) {
  const complete = lesson.total > 0 && lesson.mastered === lesson.total;
  const inProgress = lesson.introduced > 0 && !complete;

  return (
    <button
      onClick={onSelect}
      aria-label={`Start Lesson ${lesson.lesson}`}
      className={`w-full rounded-2xl bg-navy-700 p-4 flex items-center justify-between gap-3 text-left ${
        isUpNext ? 'border-l-4 border-accent' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-white">
            {'title' in lesson && lesson.title
              ? `Lesson ${lesson.lesson}: ${lesson.title}`
              : `Lesson ${lesson.lesson}`}
          </span>
          {isUpNext && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
              Up next
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-text-mute">
          {complete ? (
            <span className="text-emerald-400">Complete</span>
          ) : (
            `${lesson.introduced} / ${lesson.total} introduced`
          )}
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center">
        {complete && <CheckIcon />}
        {inProgress && (
          <span className="h-2 w-2 rounded-full bg-accent" aria-label="In progress" />
        )}
      </div>
    </button>
  );
}

export default function LessonPicker({
  scenarioId,
  scenarioTitle,
  justCompletedLesson,
  onSelectLesson,
  onBack,
}: Props) {
  const manager = useMemo(() => new SessionManager(lexicon), []);
  const stats = useMemo(() => manager.getStats(), [manager]);

  const scenarioStats = stats.perScenario.find((s) => s.scenarioId === scenarioId);
  const lessons = scenarioStats?.perLesson ?? [];

  const title =
    scenarioTitle.length > 20 ? scenarioTitle.slice(0, 19) + '…' : scenarioTitle;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-11 w-full items-center justify-between px-4">
        <button
          onClick={onBack}
          aria-label="Back to scenario picker"
          className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70"
        >
          Back
        </button>
        <span className="text-sm font-semibold text-white">{title}</span>
        <div className="w-16" />
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="space-y-3">
          {lessons.map((lesson) => {
            const upNextLesson =
              justCompletedLesson !== undefined
                ? justCompletedLesson + 1
                : undefined;
            const isUpNext = upNextLesson === lesson.lesson;

            return (
              <LessonCard
                key={lesson.lesson}
                lesson={lesson}
                isUpNext={isUpNext}
                onSelect={() => onSelectLesson(lesson.lesson)}
              />
            );
          })}
          {lessons.length === 0 && (
            <p className="text-center text-sm text-text-mute pt-12">
              No lessons available yet.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
