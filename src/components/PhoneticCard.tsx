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
    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-navy-700 p-8">
      {showEnglish && (
        <div className="mb-6 text-center text-2xl text-white/80">
          {entry.en}
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-2 font-phonetic text-3xl leading-tight tracking-wide">
        {words.map((w, i) => (
          <span
            key={i}
            className={
              wrong.has(i)
                ? 'text-red-400 underline decoration-red-400 decoration-2 underline-offset-4'
                : wrongWordIndices.length > 0
                  ? 'text-emerald-400'
                  : 'text-white'
            }
          >
            {renderSyllables(w)}
          </span>
        ))}
      </div>
      {entry.variants && entry.variants.length > 0 && (
        <div className="mt-5 flex flex-col gap-1 text-center text-sm font-phonetic text-white/60">
          {entry.variants.map((v, i) => (
            <div key={i} className="flex flex-wrap items-baseline justify-center gap-x-2">
              <span className="font-sans text-text-mute">{v.label}:</span>
              {v.phonetic.split(/\s+/).filter(Boolean).map((w, j) => (
                <span key={j}>{renderSyllables(w)}</span>
              ))}
            </div>
          ))}
        </div>
      )}
      {entry.notes && (
        <div className="mt-6 border-t border-white/10 pt-4 text-center text-sm text-text-mute">
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
