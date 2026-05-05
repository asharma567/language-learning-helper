import type { APIRoute } from 'astro';
import { assessPronunciation } from '../../lib/azure-speech';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const creds = getAzureCreds(locals);
  if (!creds) {
    return json(
      { error: 'AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured' },
      500,
    );
  }

  const incoming = await request.formData();
  const audio = incoming.get('audio');
  const referenceText = incoming.get('referenceText');
  if (!(audio instanceof Blob)) {
    return json({ error: 'missing audio blob' }, 400);
  }
  if (typeof referenceText !== 'string' || !referenceText.trim()) {
    return json({ error: 'missing referenceText' }, 400);
  }

  try {
    const result = await assessPronunciation(audio, referenceText, creds);
    return json(result);
  } catch (err) {
    return json(
      { error: 'azure pronunciation request failed', detail: String(err) },
      502,
    );
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
