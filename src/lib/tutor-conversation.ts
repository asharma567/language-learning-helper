// Pure logic for the Azure-backed tutor conversation:
//   - System prompt for Claude (reuses realtime-prompt.ts shape)
//   - Language detection per text span (Cyrillic vs Latin)
//   - SSML builder that switches voices per span (ru-RU-Svetlana for
//     Russian, en-US-Jenny for English) so each language gets a native voice
//
// No I/O — easily testable.

import type { LexiconEntry, ScenarioId } from './lexicon';
import { entriesInScenario, getScenario } from './scenarios';

export type ChatTurn = {
  role: 'user' | 'assistant';
  text: string;
};

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

/**
 * System prompt for Claude. Drives Sveta's persona, code-switching ratio,
 * drill loop, and the phrase list to work through this session. We do TTS
 * separately, so this is pure dialogue policy.
 */
export function buildAzureTutorSystemPrompt(
  scenarioId: ScenarioId,
  entries: LexiconEntry[],
): string {
  const scenario = getScenario(scenarioId);
  const phraseBlock = entries
    .map((e) => {
      const variantNote = e.variants?.length
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

LENGTH
- Keep every reply SHORT — 2-3 sentences max. This is voice; long replies feel like lectures.
- One drill prompt at a time. Don't queue multiple phrases per turn.

DRILL LOOP
1. Pick one phrase from the list below.
2. Say its English meaning, then the Russian.
3. Ask the learner to repeat (e.g. "Now you. Try it.").
4. After they speak: brief praise in Russian (молодец!, отлично!) → next phrase.
5. If they were off, ONE specific correction in English ("the stress is on the second syllable: krah-SEE-vah-yah"), then move on — don't drill the same phrase >3 times.

ERRORS
- If the learner's transcript is empty or unclear, ask in English: "Sorry, can you say that one more time?"

PERSONALITY
- Friendly, mildly playful, low-key encouraging.
- Use the learner's input verbatim when reflecting (if they say "хорошо" you can say "хорошо! Now try…").
- Never break character to mention you are an AI.

GENDER NOTE
- The learner is male. For phrases with a feminine/masculine form, drill the form he would say to a woman by default.

SCENARIO
${scenario.title} — ${scenario.description}

PHRASES FOR THIS SESSION
${phraseBlock}

OPENING
On your very first turn, greet the learner in Russian then English: "Привет! I'm Sveta. Ready to practice ${scenario.title.toLowerCase()}?" then immediately go into the first phrase.`;
}

const CYRILLIC_RE = /[Ѐ-ӿԀ-ԯ]/;
const HAS_LATIN_LETTER_RE = /[A-Za-z]/;

/**
 * Split text into spans by language. Heuristic: walk character by character,
 * grouping runs of same script. Punctuation + whitespace stick to the
 * preceding span. A span is "russian" if it contains any Cyrillic letter
 * AND no Latin letters; "english" if Latin only; "mixed/punct" inherits the
 * previous span's language. Empty result returns empty array.
 */
export type LanguageSpan = { lang: 'ru' | 'en'; text: string };

export function splitByLanguage(input: string): LanguageSpan[] {
  if (!input) return [];
  const tokens = input.match(/[А-яёЁ]+|[A-Za-z]+|[^\sА-яёЁA-Za-z]+|\s+/g) ?? [];
  const spans: LanguageSpan[] = [];
  let current: LanguageSpan | null = null;
  let lastLang: 'ru' | 'en' = 'en';

  for (const tok of tokens) {
    let lang: 'ru' | 'en';
    if (CYRILLIC_RE.test(tok)) lang = 'ru';
    else if (HAS_LATIN_LETTER_RE.test(tok)) lang = 'en';
    else lang = lastLang; // punctuation/whitespace inherits previous

    if (current && current.lang === lang) {
      current.text += tok;
    } else {
      if (current) spans.push(current);
      current = { lang, text: tok };
    }
    if (lang !== lastLang && (CYRILLIC_RE.test(tok) || HAS_LATIN_LETTER_RE.test(tok))) {
      lastLang = lang;
    }
  }
  if (current) spans.push(current);

  // Trim trailing whitespace from each span and drop empty ones
  return spans
    .map((s) => ({ ...s, text: s.text }))
    .filter((s) => s.text.trim().length > 0);
}

const RU_VOICE = 'ru-RU-SvetlanaNeural';
const EN_VOICE = 'en-US-JennyNeural';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Strip simple markdown so Azure TTS doesn't read literal asterisks/underscores.
 * Claude tends to bold key terms in its replies; TTS pronounces those as
 * "star star привет star star" without this.
 */
export function stripMarkdownForTts(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\n/g, ' ')
    .trim();
}

/**
 * Build SSML with voice-per-span for Azure TTS. Output:
 *
 *   <speak version='1.0' xml:lang='ru-RU'>
 *     <voice name='en-US-JennyNeural'>Now try:</voice>
 *     <voice name='ru-RU-SvetlanaNeural'>ты красивая</voice>
 *   </speak>
 *
 * Azure TTS produces a single seamless mp3 with proper pronunciation per span.
 */
export function buildSsml(text: string): string {
  const cleaned = stripMarkdownForTts(text);
  const spans = splitByLanguage(cleaned);
  if (spans.length === 0) {
    return `<speak version='1.0' xml:lang='en-US'><voice name='${EN_VOICE}'></voice></speak>`;
  }
  const voiceTags = spans
    .map((s) => {
      const voice = s.lang === 'ru' ? RU_VOICE : EN_VOICE;
      return `<voice name='${voice}'>${escapeXml(s.text)}</voice>`;
    })
    .join('');
  // xml:lang on the outer speak doesn't drive voice selection (that's per voice
  // tag) but is required by the schema. ru-RU is fine as a default.
  return `<speak version='1.0' xml:lang='ru-RU'>${voiceTags}</speak>`;
}
