import type { GradeResult } from '../lib/grader';

type Props = {
  result: GradeResult | null;
};

export default function ScoreFeedback({ result }: Props) {
  if (!result) return null;

  const { score, exact, heard, target, confidence } = result;
  const borderColor = exact
    ? 'border-emerald-500/40'
    : score >= 0.9
      ? 'border-amber-500/40'
      : 'border-red-500/40';

  const verdictColor = exact
    ? 'text-emerald-400'
    : score >= 0.9
      ? 'text-amber-400'
      : 'text-red-400';

  const verdict = exact
    ? 'Exact — advancing'
    : score >= 0.9
      ? 'Close — holding'
      : 'Miss — re-queued';

  return (
    <div className={`w-full max-w-2xl rounded-xl border ${borderColor} bg-navy-700 p-4 text-sm`}>
      <div className="flex items-baseline justify-between">
        <div className={`text-lg font-semibold ${verdictColor}`}>{verdict}</div>
        <div className="font-mono text-text-mute">
          {(score * 100).toFixed(0)}%
          {confidence !== null && (
            <span className="ml-3 opacity-60">
              {(confidence * 100).toFixed(0)}% conf
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1 text-white/70">
        <div>
          <span className="text-text-mute">heard:</span> {heard || '(nothing)'}
        </div>
        <div>
          <span className="text-text-mute">target:</span> {target}
        </div>
      </div>
    </div>
  );
}
