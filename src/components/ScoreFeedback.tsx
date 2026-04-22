import type { GradeResult } from '../lib/grader';

type Props = {
  result: GradeResult | null;
};

export default function ScoreFeedback({ result }: Props) {
  if (!result) return null;

  const { score, exact, heard, target, confidence } = result;
  const color = exact
    ? 'text-emerald-400 border-emerald-700'
    : score >= 0.9
      ? 'text-amber-400 border-amber-700'
      : 'text-red-400 border-red-700';

  const verdict = exact
    ? 'Exact — advancing'
    : score >= 0.9
      ? 'Close — holding'
      : 'Miss — re-queued';

  return (
    <div className={`w-full max-w-2xl rounded-xl border ${color} bg-neutral-950 p-4 text-sm`}>
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-semibold">{verdict}</div>
        <div className="font-mono text-neutral-400">
          score {(score * 100).toFixed(0)}%
          {confidence !== null && (
            <span className="ml-3">
              whisper {(confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1 text-neutral-300">
        <div>
          <span className="text-neutral-500">heard:</span> {heard || '(nothing)'}
        </div>
        <div>
          <span className="text-neutral-500">target:</span> {target}
        </div>
      </div>
    </div>
  );
}
