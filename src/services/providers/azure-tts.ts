// Azure Neural TTS provider.
//
// Lookup order per call:
//   1. Audio manifest (pregenerated lexicon mp3s shipped under /audio/...).
//      Hit = zero Azure cost, edge-cached static asset.
//   2. In-memory blob cache (per-session dedup of live API fetches).
//   3. Live /api/azure-tts → Azure REST. Cached in-memory after first fetch.
// On total failure: Web Speech API fallback.

import type { TtsOptions, TtsProvider } from '../tts';
import audioManifest from '../../data/audio-manifest.json';

type AzureVoiceName =
  | 'ru-RU-SvetlanaNeural'
  | 'ru-RU-DmitryNeural'
  | 'ru-RU-DariyaNeural'
  | 'en-US-JennyNeural'
  | 'en-US-AriaNeural'
  | 'en-US-GuyNeural';

const DEFAULT_VOICE: Record<TtsOptions['lang'], AzureVoiceName> = {
  'ru-RU': 'ru-RU-SvetlanaNeural',
  'en-US': 'en-US-JennyNeural',
};

const audioCache = new Map<string, string>(); // voice::text → blob URL (live-fetched)
let currentAudio: HTMLAudioElement | null = null;

const MANIFEST = audioManifest as Record<string, string>;

function staticUrlFor(text: string, lang: TtsOptions['lang']): string | null {
  const langPrefix = lang.split('-')[0]; // 'ru-RU' → 'ru'
  return MANIFEST[`${langPrefix}:${text}`] ?? null;
}

async function fetchLiveAudio(text: string, voice: AzureVoiceName): Promise<string> {
  const key = `${voice}::${text}`;
  const cached = audioCache.get(key);
  if (cached) return cached;
  const res = await fetch('/api/azure-tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) throw new Error(`azure-tts ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  audioCache.set(key, url);
  return url;
}

function playUrl(url: string, opts: TtsOptions): Promise<void> {
  return new Promise((resolve) => {
    azureTts.stop();
    const audio = new Audio(url);
    audio.playbackRate = opts.rate ?? 1;
    audio.onended = () => { currentAudio = null; resolve(); };
    audio.onerror = () => { currentAudio = null; resolve(); };
    currentAudio = audio;
    audio.play().catch(() => resolve());
  });
}

export const azureTts: TtsProvider = {
  async speak(text, opts) {
    if (typeof window === 'undefined') return;
    // 1. Pregenerated lexicon hit — zero Azure cost, edge-cached static asset.
    const staticUrl = staticUrlFor(text, opts.lang);
    if (staticUrl) return playUrl(staticUrl, opts);

    // 2. Custom phrase / cache miss — call live Azure TTS endpoint.
    const voice = (opts.voice as AzureVoiceName) ?? DEFAULT_VOICE[opts.lang];
    try {
      const url = await fetchLiveAudio(text, voice);
      return playUrl(url, opts);
    } catch {
      const { webSpeechTts } = await import('./web-speech-tts');
      return webSpeechTts.speak(text, opts);
    }
  },
  stop() {
    if (typeof window === 'undefined') return;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  },
};
