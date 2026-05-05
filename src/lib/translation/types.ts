// Shared types + system prompt for translation providers.
// Both OpenAI and Anthropic provider modules consume the same prompt so
// behavior matches across the fallback boundary.

export type TranslationResult = {
  ru: string;
  phonetic: string;
  notes?: string;
};

export type ProviderError = {
  status?: number;
  detail?: string;
};

// Trimmed from ~1206 chars / ~300 tokens to ~700 chars / ~165 tokens.
// Kept all hard constraints; reduced 4 examples to 2 (greeting + gendered
// compliment) which cover JSON shape, stress marking, and the gender-note
// convention. The compliment example uses feminine-as-primary to lock in
// the correct default for "you're beautiful / smart / sexy" type phrases.
export const SYSTEM_PROMPT = `Translate English → casual ты-form modern Russian. Speaker is a man; compliments and romantic phrases default to addressing a woman (feminine adjective forms). Street/slang fine; mat only if the English is clearly vulgar.

Output JSON ONLY (no prose, no markdown fences):
{"ru":"<Cyrillic>","phonetic":"<Latin romanization>","notes":"<optional one-line gender/register hint>"}

Phonetic: English letters, UPPERCASE the stressed syllable, hyphens between syllables, spaces between words, ' for soft sign, ё→"yo", ы→"ih".

Examples:
"hi" → {"ru":"привет","phonetic":"pree-VYET"}
"you're beautiful" → {"ru":"ты красивая","phonetic":"TIH krah-SEE-vah-yah","notes":"To a woman. To a man: ты красивый (krah-SEE-vihy)."}`;
