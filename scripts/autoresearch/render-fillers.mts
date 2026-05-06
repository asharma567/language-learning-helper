// Pre-render short Russian filler/acknowledgment mp3s for the V1 experiment
// (instant-emit while Claude generates the substantive reply).
import { writeFile, mkdir } from 'node:fs/promises';
import { synthesizeFromSsml } from '../../src/lib/azure-speech.ts';
import { buildSsml } from '../../src/lib/tutor-conversation.ts';

const FILLERS = [
  { text: 'Хм…', slug: 'hmm' },        // thinking sound, neutral
  { text: 'Так…', slug: 'tak' },        // "so..." — natural conversational
  { text: 'Ага.', slug: 'aga' },        // "uh-huh" / acknowledgment
  { text: 'Понятно.', slug: 'ponyatno' }, // "got it"
  { text: 'Хорошо.', slug: 'horosho' }, // "good"
];

const key = process.env.AZURE_SPEECH_KEY!;
const region = process.env.AZURE_SPEECH_REGION!;
if (!key || !region) { throw new Error('AZURE creds missing'); }

await mkdir('public/audio/fillers', { recursive: true });
for (const f of FILLERS) {
  const ssml = buildSsml(f.text);
  const mp3 = await synthesizeFromSsml(ssml, { key, region });
  await writeFile(`public/audio/fillers/${f.slug}.mp3`, Buffer.from(mp3));
  console.log(`  ✓ ${f.slug}.mp3 (${mp3.byteLength} bytes) — ${f.text}`);
}
