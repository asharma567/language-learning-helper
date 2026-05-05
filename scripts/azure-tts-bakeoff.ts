// Russian TTS bake-off: generate the same set of phrases in each Azure neural
// voice so a Russian speaker can blind-rank them.
//
// Run: npx tsx scripts/azure-tts-bakeoff.ts
// Output: ~/tts-test/<voice>/<seq>.mp3 + index.html for easy A/B listening.

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { synthesizeSpeech, type AzureVoice } from '../src/lib/azure-speech';

const VOICES: AzureVoice[] = [
  'ru-RU-SvetlanaNeural',
  'ru-RU-DmitryNeural',
  'ru-RU-DariyaNeural',
];

const PHRASES = [
  { id: '01-greet-short', text: 'привет' },
  { id: '02-greet-formal', text: 'спасибо' },
  { id: '03-flirt-short', text: 'ты красивая' },
  { id: '04-flirt-medium', text: 'ты сводишь меня с ума' },
  { id: '05-flirt-long', text: 'я не могу перестать думать о тебе' },
  { id: '06-question', text: 'у тебя есть парень' },
  { id: '07-numbers', text: 'один два три четыре пять' },
  { id: '08-mat', text: 'охуенно' },
  { id: '09-romance-short', text: 'поцелуй меня' },
  { id: '10-romance-long', text: 'давай займёмся любовью' },
];

async function main() {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    console.error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set');
    process.exit(1);
  }

  const outDir = join(homedir(), 'tts-test');
  await mkdir(outDir, { recursive: true });

  const indexRows: string[] = [];
  for (const phrase of PHRASES) {
    indexRows.push(`<tr><td>${phrase.id}</td><td>${phrase.text}</td>`);
    for (const voice of VOICES) {
      const voiceDir = join(outDir, voice);
      await mkdir(voiceDir, { recursive: true });
      const file = join(voiceDir, `${phrase.id}.mp3`);
      try {
        const buf = await synthesizeSpeech(phrase.text, voice, { key, region });
        await writeFile(file, Buffer.from(buf));
        console.log(`✓ ${voice}/${phrase.id}.mp3 (${buf.byteLength} bytes)`);
        indexRows.push(`<td><audio controls src="${voice}/${phrase.id}.mp3"></audio></td>`);
      } catch (err) {
        console.error(`✗ ${voice}/${phrase.id}: ${err}`);
        indexRows.push(`<td>error</td>`);
      }
    }
    indexRows.push('</tr>');
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Russian TTS bake-off</title>
<style>body{font-family:sans-serif;padding:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:0.5rem;vertical-align:top}audio{width:240px}</style>
</head><body>
<h1>Russian TTS bake-off</h1>
<p>Listen blind, rate each voice 1–5 on naturalness and accent authenticity.</p>
<table>
<thead><tr><th>id</th><th>phrase</th>${VOICES.map((v) => `<th>${v.replace('ru-RU-', '').replace('Neural', '')}</th>`).join('')}</tr></thead>
<tbody>${indexRows.join('')}</tbody>
</table></body></html>`;
  await writeFile(join(outDir, 'index.html'), html);
  console.log(`\n✅ Done. Open: file://${join(outDir, 'index.html')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
