// Pre-render short Russian filler/acknowledgment mp3s for the V1 experiment
// (instant-emit while Claude generates the substantive reply).
//
// IMPORTANT: fillers use a NATIVE Russian voice (ru-RU-DariyaNeural), NOT the
// Multilingual Ava we use for substantive replies. Reason: Ava is English-
// primary; on a 200ms utterance like "Хм…" or "Ага.", her American-accent
// leakage is audible. A native ru-RU neural voice sounds authentically
// Russian on these short fillers. The "robotic Svetlana on long paragraphs"
// problem doesn't apply to one-word fillers.
import { writeFile, mkdir } from 'node:fs/promises';
import { synthesizeFromSsml } from '../../src/lib/azure-speech.ts';

const NATIVE_VOICE = 'ru-RU-DariyaNeural';

const FILLERS = [
  { text: 'Хм…', slug: 'hmm' },        // thinking sound, neutral
  { text: 'Так…', slug: 'tak' },        // "so..." — natural conversational
  { text: 'Ага.', slug: 'aga' },        // "uh-huh" / acknowledgment
  { text: 'Понятно.', slug: 'ponyatno' }, // "got it"
  { text: 'Хорошо.', slug: 'horosho' }, // "good"
];

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) throw new Error('AZURE creds missing');

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const ssmlFor = (text: string) =>
  `<speak version='1.0' xml:lang='ru-RU'>` +
    `<voice name='${NATIVE_VOICE}'>` +
      `<prosody rate='-4%' pitch='+2%'>${escapeXml(text)}</prosody>` +
    `</voice>` +
  `</speak>`;

await mkdir('public/audio/fillers', { recursive: true });
for (const f of FILLERS) {
  const mp3 = await synthesizeFromSsml(ssmlFor(f.text), { key, region });
  await writeFile(`public/audio/fillers/${f.slug}.mp3`, Buffer.from(mp3));
  console.log(`  ✓ ${f.slug}.mp3 (${mp3.byteLength} bytes) — ${f.text}`);
}
