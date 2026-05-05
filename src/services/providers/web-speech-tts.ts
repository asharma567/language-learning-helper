// Browser-native Web Speech API TTS provider. Used as a fallback when the
// Azure provider fails. No network roundtrip, no cost, but voice quality is
// the user's OS default (often robotic).

import type { TtsOptions, TtsProvider } from '../tts';

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
  lang: TtsOptions['lang'],
): SpeechSynthesisVoice | null {
  const langPrefix = lang.split('-')[0];
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = voices.find((v) => v.lang.startsWith(langPrefix));
  return prefix ?? null;
}

export const webSpeechTts: TtsProvider = {
  async speak(text, opts) {
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
  },
  stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
  },
};
