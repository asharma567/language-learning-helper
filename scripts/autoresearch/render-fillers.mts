import { writeFile } from 'node:fs/promises';
import { synthesizeFromSsml } from '../../src/lib/azure-speech.ts';
import { buildSsml } from '../../src/lib/tutor-conversation.ts';
const fillers = ['Хорошо.', 'Отлично!', 'Молодец!', 'Да!', 'Хм…'];
const key = process.env.AZURE_SPEECH_KEY!, region = process.env.AZURE_SPEECH_REGION!;
for (const text of fillers) {
  const ssml = buildSsml(text);
  const mp3 = await synthesizeFromSsml(ssml, { key, region });
  const fname = text.toLowerCase().replace(/[^а-яёa-z]/gi, '') + '.mp3';
  await writeFile('public/audio/fillers/' + fname, Buffer.from(mp3));
  console.log('  ✓', fname, mp3.byteLength, 'bytes');
}
