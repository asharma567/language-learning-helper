import type { APIRoute } from 'astro';
import { assessPronunciation, type PronunciationResult } from '../../lib/azure-speech';
import { gradeTranscript, normalize } from '../../lib/grader';
import { transcribeWithOpenAI } from '../../lib/openai-audio';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const creds = getAzureCreds(locals);
  const openaiKey = getEnv(locals, 'OPENAI_API_KEY');
  if (!creds && !openaiKey) {
    return json(
      { error: 'no pronunciation provider configured' },
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
    const result = creds
      ? await assessPronunciation(audio, referenceText, creds).catch((err) => {
          if (!openaiKey) throw err;
          console.warn(`[azure-pronounce] Azure failed, falling back to OpenAI transcription: ${String(err)}`);
          return assessWithOpenAITranscript(audio, referenceText, openaiKey);
        })
      : await assessWithOpenAITranscript(audio, referenceText, openaiKey as string);
    return json(result);
  } catch (err) {
    return json(
      { error: 'pronunciation request failed', detail: String(err) },
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

function getEnv(locals: App.Locals | undefined, key: string): string | undefined {
  const fromProc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const fromRuntime = (
    locals as unknown as {
      runtime?: { env?: Record<string, string | undefined> };
    }
  )?.runtime?.env?.[key];
  return fromRuntime ?? fromProc;
}

async function assessWithOpenAITranscript(
  audio: Blob,
  referenceText: string,
  openaiKey: string,
): Promise<PronunciationResult> {
  const recognizedText = await transcribeWithOpenAI(audio, openaiKey, {
    prompt: `The speaker is practicing this Russian phrase: ${referenceText}`,
  });
  const grade = gradeTranscript(referenceText, recognizedText);
  const pronScore = grade.exact ? 95 : Math.round(Math.min(89, Math.max(0, grade.score * 100)));
  const wrong = new Set(grade.wrongWordIndices);

  return {
    recognizedText,
    accuracy: pronScore,
    fluency: pronScore,
    completeness: pronScore,
    prosody: null,
    pronScore,
    words: normalize(referenceText)
      .split(' ')
      .filter(Boolean)
      .map((word, i) => ({
        word,
        accuracy: wrong.has(i) ? pronScore : 100,
        errorType: wrong.has(i) ? 'Mispronunciation' : 'None',
        phonemes: [],
      })),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
