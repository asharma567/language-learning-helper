// Azure Neural TTS provider — fetches mp3 from /api/azure-tts and plays it.
// Cached in-memory by voice+text. Falls back to Web Speech API if the
// Azure roundtrip fails entirely.

import type { TtsOptions, TtsProvider } from '../tts';

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

const audioCache = new Map<string, string>(); // voice::text → blob URL
let currentAudio: HTMLAudioElement | null = null;

async function fetchAzureAudio(text: string, voice: AzureVoiceName): Promise<string> {
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

export const azureTts: TtsProvider = {
  async speak(text, opts) {
    if (typeof window === 'undefined') return;
    const voice = (opts.voice as AzureVoiceName) ?? DEFAULT_VOICE[opts.lang];
    try {
      const url = await fetchAzureAudio(text, voice);
      return new Promise((resolve) => {
        this.stop();
        const audio = new Audio(url);
        audio.playbackRate = opts.rate ?? 1;
        audio.onended = () => { currentAudio = null; resolve(); };
        audio.onerror = () => { currentAudio = null; resolve(); };
        currentAudio = audio;
        audio.play().catch(() => resolve());
      });
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
