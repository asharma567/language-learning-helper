// TTS service — single entrypoint for components.
//
// Provider is chosen at module load via getActiveTts(). Today: Azure (with
// Web Speech automatic fallback if Azure roundtrip fails). To swap providers
// without touching components, change the factory below.

import { azureTts } from './providers/azure-tts';
import { webSpeechTts } from './providers/web-speech-tts';

export type TtsLang = 'ru-RU' | 'en-US';

export type TtsOptions = {
  lang: TtsLang;
  rate?: number;
  pitch?: number;
  /** Provider-specific voice id. Azure: e.g. 'ru-RU-SvetlanaNeural'. */
  voice?: string;
};

export interface TtsProvider {
  speak(text: string, opts: TtsOptions): Promise<void>;
  stop(): void;
}

const PROVIDERS = {
  azure: azureTts,
  webspeech: webSpeechTts,
} as const;

let active: TtsProvider = PROVIDERS.azure;

export function setTtsProvider(name: keyof typeof PROVIDERS): void {
  active = PROVIDERS[name];
}

export function getTtsProvider(): TtsProvider {
  return active;
}

// Convenience exports — what components import.
export const speak = (text: string, opts: TtsOptions) => active.speak(text, opts);
export const stopSpeaking = () => active.stop();
