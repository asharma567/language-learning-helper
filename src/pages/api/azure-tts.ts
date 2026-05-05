import type { APIRoute } from 'astro';
import { synthesizeSpeech, type AzureVoice } from '../../lib/azure-speech';

export const prerender = false;

const ALLOWED_VOICES: AzureVoice[] = [
  'ru-RU-SvetlanaNeural',
  'ru-RU-DmitryNeural',
  'ru-RU-DariyaNeural',
  'en-US-JennyNeural',
  'en-US-AriaNeural',
  'en-US-GuyNeural',
];

export const POST: APIRoute = async ({ request, locals }) => {
  const creds = getAzureCreds(locals);
  if (!creds) {
    return new Response(
      JSON.stringify({ error: 'AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  let text: string;
  let voice: AzureVoice;
  try {
    const body = (await request.json()) as { text?: string; voice?: string };
    if (!body.text || typeof body.text !== 'string') {
      return jsonError('missing text', 400);
    }
    text = body.text;
    const requested = (body.voice ?? 'ru-RU-SvetlanaNeural') as AzureVoice;
    voice = ALLOWED_VOICES.includes(requested) ? requested : 'ru-RU-SvetlanaNeural';
  } catch {
    return jsonError('invalid JSON body', 400);
  }

  try {
    const mp3 = await synthesizeSpeech(text, voice, creds);
    return new Response(mp3, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return jsonError(`azure tts failed: ${String(err)}`, 502);
  }
};

function getAzureCreds(
  locals: App.Locals | undefined,
): { key: string; region: string } | undefined {
  const fromEnv =
    typeof process !== 'undefined'
      ? {
          key: process.env?.AZURE_SPEECH_KEY,
          region: process.env?.AZURE_SPEECH_REGION,
        }
      : { key: undefined, region: undefined };
  const fromRuntime = (
    locals as unknown as {
      runtime?: {
        env?: { AZURE_SPEECH_KEY?: string; AZURE_SPEECH_REGION?: string };
      };
    }
  )?.runtime?.env;
  const key = fromRuntime?.AZURE_SPEECH_KEY ?? fromEnv.key;
  const region = fromRuntime?.AZURE_SPEECH_REGION ?? fromEnv.region;
  if (!key || !region) return undefined;
  return { key, region };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
