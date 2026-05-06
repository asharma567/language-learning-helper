// Pregenerate Azure TTS audio for every Russian + English string in the lexicon.
//
// Output: public/audio/{ru,en}/<id>.mp3 (served at /audio/... by Astro).
// Manifest: src/data/audio-manifest.json mapping `<lang>:<text>` → URL so the
// client TTS provider can short-circuit to a static fetch without 404 trial.
//
// Run: npm run audio:pregenerate
// Idempotent — skips entries whose mp3 already exists. Safe to re-run after
// adding new lexicon entries; only the newcomers cost Azure quota.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeSpeech, type AzureVoice } from '../src/lib/azure-speech';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LEXICON_PATH = join(ROOT, 'src/data/lexicon.json');
const AUDIO_DIR = join(ROOT, 'public/audio');
const MANIFEST_PATH = join(ROOT, 'src/data/audio-manifest.json');

const RU_VOICE: AzureVoice = 'ru-RU-SvetlanaNeural';
const EN_VOICE: AzureVoice = 'en-US-JennyNeural';

type LexiconEntry = {
  id: string;
  en: string;
  ru: string;
  variants?: Array<{ ru: string; phonetic: string; label: string }>;
};

type Job = {
  text: string;
  lang: 'ru' | 'en';
  voice: AzureVoice;
  filename: string; // relative to public/audio/<lang>/
  manifestKey: string;
};

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function loadKey(): Promise<{ key: string; region: string }> {
  // Read from process.env (loaded from .env via npm script's --env or set -a)
  const env = await readFile(join(ROOT, '.env'), 'utf8').catch(() => '');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error('AZURE_SPEECH_KEY + AZURE_SPEECH_REGION must be set in .env');
  }
  return { key, region };
}

function buildJobs(lexicon: LexiconEntry[]): Job[] {
  const seen = new Set<string>();
  const jobs: Job[] = [];

  for (const e of lexicon) {
    // English (one per entry)
    const enKey = `en:${e.en}`;
    if (!seen.has(enKey)) {
      seen.add(enKey);
      jobs.push({
        text: e.en,
        lang: 'en',
        voice: EN_VOICE,
        filename: `${e.id}.mp3`,
        manifestKey: enKey,
      });
    }
    // Russian primary
    const ruKey = `ru:${e.ru}`;
    if (!seen.has(ruKey)) {
      seen.add(ruKey);
      jobs.push({
        text: e.ru,
        lang: 'ru',
        voice: RU_VOICE,
        filename: `${e.id}.mp3`,
        manifestKey: ruKey,
      });
    }
    // Russian variants (gendered alts, etc.)
    for (let i = 0; i < (e.variants ?? []).length; i++) {
      const v = e.variants![i];
      const k = `ru:${v.ru}`;
      if (!seen.has(k)) {
        seen.add(k);
        jobs.push({
          text: v.ru,
          lang: 'ru',
          voice: RU_VOICE,
          filename: `${e.id}--var-${i}.mp3`,
          manifestKey: k,
        });
      }
    }
  }
  return jobs;
}

async function main() {
  const { key, region } = await loadKey();
  const lexicon = JSON.parse(await readFile(LEXICON_PATH, 'utf8')) as LexiconEntry[];
  const jobs = buildJobs(lexicon);

  await mkdir(join(AUDIO_DIR, 'ru'), { recursive: true });
  await mkdir(join(AUDIO_DIR, 'en'), { recursive: true });

  // Load existing manifest so we keep entries that haven't changed.
  let manifest: Record<string, string> = {};
  if (await fileExists(MANIFEST_PATH)) {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Record<string, string>;
  }

  let synthesized = 0;
  let skipped = 0;
  let failed = 0;
  let bytesTotal = 0;

  for (const job of jobs) {
    const filePath = join(AUDIO_DIR, job.lang, job.filename);
    const url = `/audio/${job.lang}/${job.filename}`;
    if (await fileExists(filePath)) {
      manifest[job.manifestKey] = url;
      skipped += 1;
      continue;
    }
    try {
      const buf = await synthesizeSpeech(job.text, job.voice, { key, region });
      await writeFile(filePath, Buffer.from(buf));
      manifest[job.manifestKey] = url;
      synthesized += 1;
      bytesTotal += buf.byteLength;
      if (synthesized % 25 === 0) {
        console.log(`  …${synthesized} synthesized so far`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${job.lang}/${job.filename} (${job.text}): ${String(err).slice(0, 200)}`);
    }
  }

  // Sort manifest keys for stable diffs
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k];
  await writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n');

  const azureCharsBilled = jobs
    .filter((j, i) => i < synthesized) // approximation: count newly-synthesized only
    .reduce((acc, j) => acc + j.text.length, 0);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✓ Synthesized: ${synthesized}`);
  console.log(`⤍ Skipped (already exist): ${skipped}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`📦 New bytes: ${(bytesTotal / 1024).toFixed(1)} KB`);
  console.log(`📊 Manifest entries: ${Object.keys(sorted).length}`);
  console.log(`💰 Azure billed: ~${azureCharsBilled} chars (Free F0 tier: 500K/mo)`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
