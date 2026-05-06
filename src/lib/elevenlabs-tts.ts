// ElevenLabs TTS client.
// Multilingual_v2 model handles Russian + English in a single call with
// dramatically more natural prosody than Azure's basic ru-RU-Svetlana.
// Free tier: 10K chars/month, 3 voice slots. Paid upgrade requires a card.
//
// Voice picked: EXAVITQu4vr4xnSDxMaL (Sarah, "Mature, Reassuring, Confident")
// — works on free tier, female, warm tone, handles Russian via multilingual.
// Other free-tier-compatible voices listed via GET /v1/voices.

export const ELEVENLABS_VOICE_SVETA = 'EXAVITQu4vr4xnSDxMaL';
export const ELEVENLABS_MODEL_QUALITY = 'eleven_multilingual_v2';
export const ELEVENLABS_MODEL_FAST = 'eleven_flash_v2_5';

export type ElevenLabsCreds = { apiKey: string };

export type ElevenLabsOptions = {
  voiceId?: string;
  modelId?: string;
  outputFormat?: string; // mp3_22050_32 = same bitrate Azure used; smaller payload
  stability?: number;    // 0-1, default 0.5 (lower = more expressive, higher = more stable)
  similarity?: number;   // 0-1, default 0.75 (how strongly to match the source voice)
  style?: number;        // 0-1, default 0 (style exaggeration)
};

export async function synthesizeWithElevenLabs(
  text: string,
  creds: ElevenLabsCreds,
  opts: ElevenLabsOptions = {},
): Promise<ArrayBuffer> {
  const voiceId = opts.voiceId ?? ELEVENLABS_VOICE_SVETA;
  const modelId = opts.modelId ?? ELEVENLABS_MODEL_QUALITY;
  const outputFormat = opts.outputFormat ?? 'mp3_22050_32';

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': creds.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarity ?? 0.75,
        style: opts.style ?? 0,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`elevenlabs ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}
