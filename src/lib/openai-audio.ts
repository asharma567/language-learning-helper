// OpenAI Audio REST helpers used as a resilient fallback when Azure Speech is
// unavailable. Keep this fetch-based so it runs in Cloudflare Workers without
// bundling the OpenAI SDK.

export type OpenAITtsVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'coral'
  | 'echo'
  | 'fable'
  | 'marin'
  | 'nova'
  | 'onyx'
  | 'sage'
  | 'shimmer'
  | 'verse'
  | 'cedar';

export type OpenAITtsOptions = {
  model?: string;
  voice?: OpenAITtsVoice;
  instructions?: string;
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
};

export type OpenAITranscribeOptions = {
  model?: string;
  prompt?: string;
  responseFormat?: 'json' | 'text';
};

const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

const DEFAULT_SVETA_TTS_INSTRUCTIONS =
  'Speak naturally and clearly as Sveta, a warm Russian tutor. Pronounce Russian natively, keep English friendly, and use a pace that is easy for a learner to follow.';

export async function synthesizeWithOpenAI(
  text: string,
  apiKey: string,
  opts: OpenAITtsOptions = {},
): Promise<ArrayBuffer> {
  const input = text.trim();
  if (!input) throw new Error('openai tts failed: empty input');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_TTS_MODEL,
      input,
      voice: opts.voice ?? 'marin',
      instructions: opts.instructions ?? DEFAULT_SVETA_TTS_INSTRUCTIONS,
      response_format: opts.responseFormat ?? 'mp3',
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`openai tts failed: ${res.status} ${detail.slice(0, 300)}`);
  }

  return res.arrayBuffer();
}

export async function transcribeWithOpenAI(
  audio: Blob,
  apiKey: string,
  opts: OpenAITranscribeOptions = {},
): Promise<string> {
  const fd = new FormData();
  fd.append('file', audio, filenameForAudio(audio.type));
  fd.append('model', opts.model ?? DEFAULT_TRANSCRIBE_MODEL);
  fd.append('response_format', opts.responseFormat ?? 'json');
  if (opts.prompt) fd.append('prompt', opts.prompt);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: fd,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`openai transcription failed: ${res.status} ${detail.slice(0, 300)}`);
  }

  if ((opts.responseFormat ?? 'json') === 'text') {
    return (await res.text()).trim();
  }

  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return (data.text ?? '').trim();
}

function filenameForAudio(mime: string): string {
  if (mime.includes('webm')) return 'speech.webm';
  if (mime.includes('ogg')) return 'speech.ogg';
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'speech.mp3';
  if (mime.includes('wav')) return 'speech.wav';
  return 'speech.webm';
}
