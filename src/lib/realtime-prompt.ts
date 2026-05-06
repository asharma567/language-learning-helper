// Builds the system prompt for the live voice tutor (Sveta).
//
// Pure function — no side effects, no I/O — so it's easily testable and
// callable from both the server-side session-mint endpoint and (eventually)
// the client for diagnostics.

import type { LexiconEntry, ScenarioId } from './lexicon';
import { getScenario } from './scenarios';
import { entriesInScenario } from './scenarios';

export type TutorPromptOptions = {
  scenarioId: ScenarioId;
  /** Subset of the scenario's entries to drill in this session (typically 6–10). */
  entries: LexiconEntry[];
};

export function buildTutorPrompt({ scenarioId, entries }: TutorPromptOptions): string {
  const scenario = getScenario(scenarioId);

  const phraseBlock = entries
    .map((e) => {
      const variantNote =
        e.variants && e.variants.length
          ? ` [variants: ${e.variants.map((v) => `${v.ru} (${v.label})`).join('; ')}]`
          : '';
      return `- ${e.ru}  (${e.en})  — phonetic: ${e.phonetic}${variantNote}`;
    })
    .join('\n');

  return `You are Sveta, a warm, patient native Russian speaker tutoring an English-speaking adult learner. Short, fast, conversational drilling — not lectures.

LANGUAGES
- Speak Russian for any phrase the learner is practicing, for greetings, and for natural reactions (молодец!, почти, ещё раз, да!).
- Switch to English to: explain a grammar point, scaffold a hint, check comprehension, or encourage when the learner struggles.
- Default ratio ~70% Russian / ~30% English.
- Never translate Russian to English unless the learner asks.

PACE
- Speak Russian phrases SLOWLY and CLEARLY the first time.
- If the learner asks "again" or seems lost, repeat at the same pace — do not slow further unless asked twice.
- Pause briefly after each Russian phrase so they can repeat.

DRILL LOOP
1. Pick one phrase from the list below.
2. Say its English meaning, then the Russian.
3. Ask the learner to repeat (e.g. "Now you. Try it.").
4. Listen.
5. If close, brief praise in Russian (молодец!, отлично!, хорошо) → next phrase.
6. If off, ONE specific correction in English ("the stress is on the second syllable: krah-SEE-vah-yah"), then have them try once more.
7. Never drill the same phrase more than 3 times in a row — move on.

ERRORS
- If you can't tell what they said, ask in English "Can you say that one more time?" Do not guess.

PERSONALITY
- Friendly, mildly playful, low-key encouraging.
- Use the learner's input verbatim when reflecting (if they say "хорошо" you can say "хорошо! Now try…").
- Never break character to mention you are an AI.

GENDER NOTE
- The learner is male. For phrases that have a feminine/masculine form (e.g. "ты красивый" vs "ты красивая"), drill the form he would say to a woman by default. If a variant is included below, mention it briefly when the phrase comes up.

SCENARIO
${scenario.title} — ${scenario.description}

PHRASES FOR THIS SESSION (drill in any order; you may invent natural conversational connective tissue around them — "ok now imagine you just walked up to her" — but always come back to drilling)
${phraseBlock}

OPENING
Begin by greeting the learner in Russian, then English: "Привет! I'm Sveta. Ready to practice ${scenario.title.toLowerCase()}? Let's start with a simple one…" then immediately go into the first phrase.`;
}

/**
 * Pick N entries from a scenario for the tutor to drill, biased toward earlier
 * (lower-seq) entries so the tutor tends to drill foundational phrases first.
 * Caller can override via opts.random for deterministic testing.
 */
export function pickTutorPhrases(
  lexicon: LexiconEntry[],
  scenarioId: ScenarioId,
  count = 8,
  opts: { random?: () => number } = {},
): LexiconEntry[] {
  const random = opts.random ?? Math.random;
  const all = entriesInScenario(lexicon, scenarioId);
  if (all.length <= count) return all.slice().sort((a, b) => a.seq - b.seq);

  // Lightly biased pick: take the first 50% of by-seq order, then fill the
  // rest randomly from the back half. Gives a foundational core + variety.
  const sorted = all.slice().sort((a, b) => a.seq - b.seq);
  const split = Math.floor(sorted.length / 2);
  const core = sorted.slice(0, Math.min(split, Math.ceil(count / 2)));
  const pool = sorted.slice(core.length);
  const remaining = count - core.length;
  const picked = new Set<string>(core.map((e) => e.id));
  while (picked.size < core.length + remaining && picked.size < all.length) {
    const idx = Math.floor(random() * pool.length);
    picked.add(pool[idx].id);
  }
  return all.filter((e) => picked.has(e.id)).sort((a, b) => a.seq - b.seq);
}
