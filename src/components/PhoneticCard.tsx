import type { LexiconEntry } from '../lib/lexicon';

type Props = {
  entry: LexiconEntry;
  wrongWordIndices?: number[];
  showEnglish?: boolean;
};

export default function PhoneticCard({
  entry,
  wrongWordIndices = [],
  showEnglish = true,
}: Props) {
  const words = entry.phonetic.split(/\s+/).filter(Boolean);
  const wrong = new Set(wrongWordIndices);

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-950 p-8">
      {showEnglish && (
        <div className="mb-6 text-center text-2xl text-neutral-300">
          {entry.en}
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-2 font-phonetic text-4xl leading-tight tracking-wide">
        {words.map((w, i) => (
          <span
            key={i}
            className={
              wrong.has(i)
                ? 'text-red-400 underline decoration-red-400 decoration-2 underline-offset-4'
                : wrongWordIndices.length > 0
                  ? 'text-emerald-400'
                  : 'text-neutral-100'
            }
          >
            {renderSyllables(w)}
          </span>
        ))}
      </div>
      {entry.notes && (
        <div className="mt-6 border-t border-neutral-800 pt-4 text-center text-sm text-neutral-400">
          {entry.notes}
        </div>
      )}
    </div>
  );
}

function renderSyllables(word: string): React.ReactNode {
  const parts = word.split('-');
  return parts.map((p, i) => (
    <span key={i}>
      <span className={isStressed(p) ? 'font-bold' : 'font-normal'}>{p}</span>
      {i < parts.length - 1 && (
        <span className="mx-0.5 text-neutral-600">·</span>
      )}
    </span>
  ));
}

function isStressed(syllable: string): boolean {
  // A syllable is stressed if its letters are entirely uppercase (ignoring ' marks).
  const letters = syllable.replace(/['.,!?]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}
