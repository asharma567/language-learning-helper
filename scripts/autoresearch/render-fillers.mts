// Pre-render short Russian filler/acknowledgment mp3s for the V1 experiment
// (instant-emit while Claude generates the substantive reply).
// Voice MUST match Sveta's main TTS voice (currently ElevenLabs Sarah on
// multilingual_v2) — otherwise the user hears a jarring voice switch.
import { writeFile, mkdir } from 'node:fs/promises';
import { synthesizeWithElevenLabs, ELEVENLABS_VOICE_SVETA } from '../../src/lib/elevenlabs-tts.ts';

const FILLERS = [
  { text: 'Хм…', slug: 'hmm' },        // thinking sound, neutral
  { text: 'Так…', slug: 'tak' },        // "so..." — natural conversational
  { text: 'Ага.', slug: 'aga' },        // "uh-huh" / acknowledgment
  { text: 'Понятно.', slug: 'ponyatno' }, // "got it"
  { text: 'Хорошо.', slug: 'horosho' }, // "good"
];

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');

await mkdir('public/audio/fillers', { recursive: true });
for (const f of FILLERS) {
  const mp3 = await synthesizeWithElevenLabs(f.text, { apiKey }, {
    voiceId: ELEVENLABS_VOICE_SVETA,
    // Slight stability bump for short utterances so they're consistent
    stability: 0.6,
  });
  await writeFile(`public/audio/fillers/${f.slug}.mp3`, Buffer.from(mp3));
  console.log(`  ✓ ${f.slug}.mp3 (${mp3.byteLength} bytes) — ${f.text}`);
}
