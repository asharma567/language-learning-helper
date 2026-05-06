// Azure Cognitive Services Speech REST client.
// TTS: neural ru-RU voices.
// STT + Pronunciation Assessment: phoneme-level scoring against a reference text.

export type AzureCreds = {
  key: string;
  region: string;
};

export type AzureVoice =
  | 'ru-RU-SvetlanaNeural'
  | 'ru-RU-DmitryNeural'
  | 'ru-RU-DariyaNeural'
  | 'en-US-JennyNeural'
  | 'en-US-AriaNeural'
  | 'en-US-GuyNeural';

export type PhonemeScore = {
  phoneme: string;
  accuracy: number;
};

export type WordScore = {
  word: string;
  accuracy: number;
  errorType: 'None' | 'Omission' | 'Insertion' | 'Mispronunciation' | string;
  phonemes: PhonemeScore[];
};

export type PronunciationResult = {
  recognizedText: string;
  accuracy: number;
  fluency: number;
  completeness: number;
  prosody: number | null;
  pronScore: number;
  words: WordScore[];
};

export async function synthesizeSpeech(
  text: string,
  voice: AzureVoice,
  creds: AzureCreds,
): Promise<ArrayBuffer> {
  const lang = voice.startsWith('en-') ? 'en-US' : 'ru-RU';
  const ssml = `<speak version='1.0' xml:lang='${lang}'><voice xml:lang='${lang}' name='${voice}'>${escapeXml(text)}</voice></speak>`;
  return postSsml(ssml, creds);
}

/**
 * Synthesize from caller-supplied SSML. Used by the tutor pipeline to emit
 * mixed-language audio (Russian + English) in a single mp3 by switching
 * <voice> tags per language span.
 */
export async function synthesizeFromSsml(
  ssml: string,
  creds: AzureCreds,
): Promise<ArrayBuffer> {
  return postSsml(ssml, creds);
}

async function postSsml(ssml: string, creds: AzureCreds): Promise<ArrayBuffer> {
  const url = `https://${creds.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': creds.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'language-learning-helper',
    },
    body: ssml,
  });
  if (!res.ok) {
    throw new Error(`azure tts failed: ${res.status} ${await res.text()}`);
  }
  return res.arrayBuffer();
}

export async function assessPronunciation(
  audio: Blob,
  referenceText: string,
  creds: AzureCreds,
): Promise<PronunciationResult> {
  const config = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableMiscue: false,
    EnableProsodyAssessment: true,
  };
  const configHeader = btoa(unescape(encodeURIComponent(JSON.stringify(config))));

  const contentType = pickAzureContentType(audio.type);
  const url = `https://${creds.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ru-RU&format=detailed`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': creds.key,
      'Content-Type': contentType,
      'Pronunciation-Assessment': configHeader,
      Accept: 'application/json',
    },
    body: audio,
  });
  if (!res.ok) {
    throw new Error(
      `azure pronunciation failed: ${res.status} ${await res.text()}`,
    );
  }
  const raw = (await res.json()) as AzureDetailedResponse;
  return parseAzureResult(raw);
}

type AzureWordRaw = {
  Word: string;
  AccuracyScore?: number;
  ErrorType?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
  Phonemes?: Array<{
    Phoneme?: string;
    AccuracyScore?: number;
    PronunciationAssessment?: { AccuracyScore?: number };
  }>;
};

type AzureNBestRaw = {
  Display?: string;
  Lexical?: string;
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
  ProsodyScore?: number;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    PronScore?: number;
    ProsodyScore?: number;
  };
  Words?: AzureWordRaw[];
};

type AzureDetailedResponse = {
  RecognitionStatus: string;
  DisplayText?: string;
  NBest?: AzureNBestRaw[];
};

function parseAzureResult(raw: AzureDetailedResponse): PronunciationResult {
  const best = raw.NBest?.[0];
  if (!best) {
    return {
      recognizedText: raw.DisplayText ?? '',
      accuracy: 0,
      fluency: 0,
      completeness: 0,
      prosody: null,
      pronScore: 0,
      words: [],
    };
  }
  // Azure returns scores either flat on the NBest item OR nested under
  // PronunciationAssessment depending on API version. Check both.
  const pa = best.PronunciationAssessment;
  return {
    recognizedText: best.Display ?? raw.DisplayText ?? '',
    accuracy: best.AccuracyScore ?? pa?.AccuracyScore ?? 0,
    fluency: best.FluencyScore ?? pa?.FluencyScore ?? 0,
    completeness: best.CompletenessScore ?? pa?.CompletenessScore ?? 0,
    prosody: best.ProsodyScore ?? pa?.ProsodyScore ?? null,
    pronScore: best.PronScore ?? pa?.PronScore ?? 0,
    words: (best.Words ?? []).map((w) => ({
      word: w.Word,
      accuracy: w.AccuracyScore ?? w.PronunciationAssessment?.AccuracyScore ?? 0,
      errorType:
        w.ErrorType ?? w.PronunciationAssessment?.ErrorType ?? 'None',
      phonemes: (w.Phonemes ?? []).map((p) => ({
        phoneme: p.Phoneme ?? '',
        accuracy: p.AccuracyScore ?? p.PronunciationAssessment?.AccuracyScore ?? 0,
      })),
    })),
  };
}

function pickAzureContentType(mime: string): string {
  if (mime.includes('webm')) return 'audio/webm; codecs=opus';
  if (mime.includes('ogg')) return 'audio/ogg; codecs=opus';
  if (mime.includes('wav')) return 'audio/wav; codecs=audio/pcm; samplerate=16000';
  return 'audio/webm; codecs=opus';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
