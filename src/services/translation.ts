// Translation service — single entrypoint for components.
//
// Today: server-side `/api/translate-phrase` orchestrates OpenAI (primary)
// with Anthropic Claude as automatic fallback. The `provider` field on the
// result tells the client which one actually answered.
//
// Wraps the active provider with a localStorage-backed cache keyed by the
// (normalized) English string so re-typing a phrase costs zero tokens.

import { apiTranslation } from './providers/api-translation';

export type TranslationResult = {
  ru: string;
  phonetic: string;
  notes?: string;
  /** Which server-side LLM produced this translation. Absent for non-API providers. */
  provider?: 'openai' | 'anthropic';
  /** True when the result was served from the local cache (no API call). */
  cached?: boolean;
};

export interface TranslationProvider {
  translate(en: string): Promise<TranslationResult>;
}

const PROVIDERS = {
  api: apiTranslation,
} as const;

let active: TranslationProvider = PROVIDERS.api;

export function setTranslationProvider(name: keyof typeof PROVIDERS): void {
  active = PROVIDERS[name];
}

export function getTranslationProvider(): TranslationProvider {
  return active;
}

const CACHE_KEY = 'translation-cache:v1';
const MAX_CACHE_ENTRIES = 200;

function normalizeEn(en: string): string {
  return en.trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadCache(): Record<string, TranslationResult> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, TranslationResult>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, TranslationResult>): void {
  if (typeof localStorage === 'undefined') return;
  // Trim oldest entries if over limit (insertion-ordered keys via Object.keys)
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) delete cache[k];
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // quota exceeded — silently skip
  }
}

export async function translatePhrase(en: string): Promise<TranslationResult> {
  const key = normalizeEn(en);
  const cache = loadCache();
  const hit = cache[key];
  if (hit) return { ...hit, cached: true };
  const result = await active.translate(en);
  cache[key] = result;
  saveCache(cache);
  return result;
}

export function clearTranslationCache(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(CACHE_KEY);
}
