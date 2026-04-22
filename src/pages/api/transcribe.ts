import type { APIRoute } from 'astro';

export const prerender = false;

type WhisperResponse = {
  text: string;
  segments?: Array<{ avg_logprob: number }>;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = getApiKey(locals);
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY not configured' }, 500);
  }

  const incoming = await request.formData();
  const audio = incoming.get('audio');
  if (!(audio instanceof Blob)) {
    return json({ error: 'missing audio blob' }, 400);
  }

  const outgoing = new FormData();
  const filename = mimeToFilename(audio.type);
  outgoing.append('file', audio, filename);
  outgoing.append('model', 'whisper-1');
  outgoing.append('language', 'ru');
  outgoing.append('response_format', 'verbose_json');

  const whisper = await fetch(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outgoing,
    },
  );

  if (!whisper.ok) {
    const detail = await whisper.text();
    return json(
      { error: 'whisper request failed', status: whisper.status, detail },
      502,
    );
  }

  const data = (await whisper.json()) as WhisperResponse;
  const avgLogprob = averageLogprob(data.segments);
  const confidence = avgLogprob === null ? null : Math.exp(avgLogprob);

  return json({
    text: data.text ?? '',
    confidence,
  });
};

function getApiKey(locals: App.Locals | undefined): string | undefined {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined;
  const fromRuntime = (locals as unknown as {
    runtime?: { env?: { OPENAI_API_KEY?: string } };
  })?.runtime?.env?.OPENAI_API_KEY;
  return fromRuntime ?? fromEnv;
}

function mimeToFilename(mime: string): string {
  if (mime.includes('webm')) return 'audio.webm';
  if (mime.includes('ogg')) return 'audio.ogg';
  if (mime.includes('mp4')) return 'audio.mp4';
  if (mime.includes('wav')) return 'audio.wav';
  return 'audio.webm';
}

function averageLogprob(segments: WhisperResponse['segments']): number | null {
  if (!segments || segments.length === 0) return null;
  const sum = segments.reduce((acc, s) => acc + (s.avg_logprob ?? 0), 0);
  return sum / segments.length;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
