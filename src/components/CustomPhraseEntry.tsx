// Lets the user type any English phrase, translates it via OpenAI,
// and constructs an ad-hoc LexiconEntry to feed into the Lesson player.
// Skips SRS / lexicon persistence — these are one-off practice items.

import { useState } from 'react';
import { translatePhrase } from '../services/translation';
import type { LexiconEntry } from '../lib/lexicon';

type Props = {
  onReady: (entry: LexiconEntry) => void;
  onCancel: () => void;
};

export default function CustomPhraseEntry({ onReady, onCancel }: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const result = await translatePhrase(trimmed);
      // Synthesize a one-off LexiconEntry compatible with the rest of the app.
      // ID is unique per attempt — these don't enter persistent SRS state.
      const entry: LexiconEntry = {
        id: `custom-${Date.now().toString(36)}`,
        en: trimmed,
        ru: result.ru,
        phonetic: result.phonetic,
        category: 'custom',
        tier: 1,
        scenario: 'approach-greet', // placeholder; never used in custom flow
        seq: 1,
        lesson: 1,
        notes: result.notes,
      };
      onReady(entry);
    } catch (err) {
      setError(`Translation failed: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-xl">
        <button
          type="button"
          onClick={onCancel}
          className="mb-8 text-sm text-text-mute hover:text-white"
        >
          ← Back
        </button>

        <h1 className="mb-2 text-3xl font-semibold">Try any phrase</h1>
        <p className="mb-8 text-text-mute">
          Type something in English. We'll translate, show the Russian + phonetic, and let you practice it like any other lesson item.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='e.g. "do you want to grab a drink later?"'
            rows={3}
            maxLength={200}
            disabled={loading}
            autoFocus
            className="w-full resize-none rounded-xl border border-white/10 bg-navy-700 p-4 text-lg text-white placeholder:text-text-mute focus:border-accent-blue focus:outline-none"
          />
          <div className="flex items-center justify-between text-sm text-text-mute">
            <span>{text.length} / 200</span>
            {error && <span className="text-red-400">{error}</span>}
          </div>
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="rounded-xl bg-accent-blue px-6 py-4 text-lg font-semibold text-white transition disabled:opacity-40"
          >
            {loading ? 'Translating…' : 'Translate & practice'}
          </button>
        </form>
      </div>
    </div>
  );
}
