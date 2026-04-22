// TTS is a v1/v2 swap point.
// v1: Web Speech API, free and offline.
// v2: ElevenLabs pregenerated MP3s — check entry.audioUrl first, fall back to Web Speech.

export type SpeakOptions = {
  lang: 'ru-RU' | 'en-US';
  rate?: number;
  pitch?: number;
};

let voicesCache: SpeechSynthesisVoice[] | null = null;

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesCache && voicesCache.length) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    const v = speechSynthesis.getVoices();
    if (v.length) {
      voicesCache = v;
      resolve(v);
      return;
    }
    const onVoices = () => {
      voicesCache = speechSynthesis.getVoices();
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
      resolve(voicesCache);
    };
    speechSynthesis.addEventListener('voiceschanged', onVoices);
  });
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: SpeakOptions['lang'],
): SpeechSynthesisVoice | null {
  const langPrefix = lang.split('-')[0];
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = voices.find((v) => v.lang.startsWith(langPrefix));
  return prefix ?? null;
}

export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = await getVoices();
  const voice = pickVoice(voices, opts.lang);

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = opts.lang;
    utter.rate = opts.rate ?? 0.9;
    utter.pitch = opts.pitch ?? 1;
    if (voice) utter.voice = voice;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  });
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined') return;
  speechSynthesis.cancel();
}
