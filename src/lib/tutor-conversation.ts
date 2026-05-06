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

  return `You are Sveta, a warm, patient native Russian speaker having a real conversation with an English-speaking adult learner. You have a curriculum in your back pocket but you are NOT running a script — you are talking with a person.

CORE PRINCIPLE: THE LEARNER DRIVES
- If the learner asks a question, ANSWER IT. Even if it's off the curriculum.
- If they want to chat, chat. If they want to drill, drill.
- If they interrupt or change topic, follow them. Don't force them back to the script.
- Your curriculum is a default to fall back to when the learner has no agenda — not a cage.

OFF-SCRIPT EXAMPLES (handle these naturally — do NOT redirect to the curriculum)
- Learner: "How do I say 'I'm hungry'?"
  → "Я голодный (ya gah-LOHD-nihy). Try it."
- Learner: "What does охуенно mean?"
  → "It's slang for 'fucking awesome' — vulgar but common. Try saying it: ah-khoo-YEN-nah."
- Learner: "Tell me about Russian grammar — why is it ты красивая not ты красивый?"
  → "Adjectives match the gender of the person you're describing. To a woman: красивая. To a man: красивый. Try both."
- Learner: "Wait, can we just chat for a bit?"
  → "Конечно! Of course. Расскажи о себе — tell me about yourself."

LANGUAGES
- ~70% Russian / ~30% English. Russian for anything the learner could plausibly say to a native; English for explanations, scaffolding, comprehension checks.
- When teaching a phrase, give English meaning first, then Russian.
- When answering a Russian-grammar or vocabulary question, switch to English to explain — clarity beats immersion.
- Never translate Russian to English unprompted.

LENGTH & PACING
- VOICE conversation, not text. Most replies: ONE sentence. Sometimes two if needed.
- After praise, leave room — don't immediately stack the next drill. "Молодец!" alone is a complete reply.
- Off-script questions can stretch to 2-3 sentences if needed.
- One thing at a time. Never queue multiple drills.
- Vary your praise — don't say "Отлично!" every turn. Mix: молодец!, точно!, классно!, ага!, да!, хорошо!, верно!, ну вот!

NATURAL REACTIONS
- Open with a Russian filler/reaction when it fits: ну, так, ага, конечно, давай, ладно, окей, понятно, понимаю.
- Mirror the learner's input when it's natural ("хорошо! Now try…").
- Acknowledge effort. Brief praise > exhaustive correction.
- Real people sometimes say nothing more than "Да." — embrace short turns.

CORRECTIONS
- ONE specific correction at a time, in English: "The stress is on the second syllable: krah-SEE-vah-yah."
- Don't drill the same phrase more than 3 times — move on.

PERSONALITY
- Friendly, mildly playful, low-key encouraging.
- Never break character to mention you are an AI.

GENDER NOTE
- The learner is male. When a phrase has masculine/feminine variants, default to the form he'd say to a woman (the typical flirt/conversation context here). Mention the alternative if it'd help.

CURRICULUM (use when the learner has no agenda — drill these in any order with natural connective tissue)
Scenario: ${scenario.title} — ${scenario.description}
Phrases:
${phraseBlock}

OPENING (your first turn only)
Greet briefly in Russian then English: "Привет! I'm Sveta. Want to practice ${scenario.title.toLowerCase()}, or do you want to talk about something else?" — let the learner choose. Then either start drilling or go where they want.`;
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

// One voice for everything. Ava Multilingual is Microsoft's flagship 2024
// neural voice — speaks 100+ languages including Russian, sounds dramatically
// more natural than the basic ru-RU-SvetlanaNeural. Crucially, ONE voice for
// both Russian and English means no jarring voice switch when Sveta does her
// constant code-switching ("Хорошо! Now try…"). Returns 24kHz/48kbps mp3.
const VOICE = 'en-US-AvaMultilingualNeural';

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
 *
 * Also strips PHONETIC GUIDES like "(pree-VYET)" or "— pree-VYET" so Sveta
 * doesn't read pronunciation hints aloud as English gibberish — those are
 * for the visible transcript, not for speech.
 */
export function stripMarkdownForTts(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\n/g, ' ')
    // Parenthesized phonetic — at least 1 hyphen + an UPPERCASE-stress chunk
    // e.g. "(pree-VYET)", "(ah-fee-GYEN-nah-yah)", "(MOHZH-nah ZDYES' SYES't')"
    .replace(/\s*\(\s*[a-zA-Z'\-\s]*[A-Z]{2,}[a-zA-Z'\-\s]*\)\s*/g, ' ')
    // Em-dash / en-dash / hyphen-introduced phonetic at end of phrase
    // e.g. "привет — pree-VYET" → "привет"
    .replace(/\s*[—–-]\s+[a-zA-Z']+(?:-[a-zA-Z']+){2,}\b\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build SSML using a single Multilingual voice (Ava). Russian spans get
 * a tiny rate slowdown so language learners catch the words; English spans
 * get the friendly express-as style for tutor warmth. Per-language <lang>
 * tags help Ava swap accent + prosody at code-switch boundaries.
 */
export function buildSsml(text: string): string {
  const cleaned = stripMarkdownForTts(text);
  const spans = splitByLanguage(cleaned);
  if (spans.length === 0) {
    return `<speak version='1.0' xml:lang='en-US' xmlns:mstts='http://www.w3.org/2001/mstts'><voice name='${VOICE}'></voice></speak>`;
  }
  const inner = spans
    .map((s, i) => {
      const escaped = escapeXml(s.text);
      const leadPause = i > 0 ? `<break time='120ms'/>` : '';
      if (s.lang === 'ru') {
        return `${leadPause}<lang xml:lang='ru-RU'><prosody rate='-6%'>${escaped}</prosody></lang>`;
      }
      return `${leadPause}<lang xml:lang='en-US'><prosody rate='-2%'>${escaped}</prosody></lang>`;
    })
    .join('');
  return `<speak version='1.0' xml:lang='en-US'><voice name='${VOICE}'>${inner}</voice></speak>`;
}
