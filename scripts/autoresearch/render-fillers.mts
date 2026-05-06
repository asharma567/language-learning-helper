// Pre-render short Russian filler/acknowledgment mp3s for the V1 experiment.
// Voice: ElevenLabs Sarah (EXAVITQu4vr4xnSDxMaL) on multilingual_v2 to MATCH
// Sveta's main TTS voice (ElevenLabs is now on Starter tier so PROD requests
// from CF Worker IPs are unblocked). Single voice = no jagged accent
// transitions between filler and substantive reply.
import { writeFile, mkdir } from 'node:fs/promises';
import { synthesizeWithElevenLabs, ELEVENLABS_VOICE_SVETA } from '../../src/lib/elevenlabs-tts.ts';

const FILLERS = [
  { text: 'Хм…', slug: 'hmm' },
  { text: 'Так…', slug: 'tak' },
  { text: 'Ага.', slug: 'aga' },
  { text: 'Понятно.', slug: 'ponyatno' },
  { text: 'Хорошо.', slug: 'horosho' },
];

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');

await mkdir('public/audio/fillers', { recursive: true });
for (const f of FILLERS) {
  const mp3 = await synthesizeWithElevenLabs(f.text, { apiKey }, {
    voiceId: ELEVENLABS_VOICE_SVETA, stability: 0.6,
  });
  await writeFile(`public/audio/fillers/${f.slug}.mp3`, Buffer.from(mp3));
  console.log(`  ✓ ${f.slug}.mp3 (${mp3.byteLength} bytes) — ${f.text}`);
}
