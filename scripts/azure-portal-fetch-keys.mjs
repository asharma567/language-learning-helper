// Hybrid Azure portal key fetcher.
//
// 1. Opens Chromium at portal.azure.com (persistent profile)
// 2. You log in + click through the resource creation yourself
//    (90 seconds — Azure portal forms are too dynamic to script reliably)
// 3. The script polls every 3s for any "Keys and Endpoint" page in the
//    Speech resource. When KEY 1 appears in the DOM, it grabs it
//    and writes .env automatically.
//
// Run: node scripts/azure-portal-fetch-keys.mjs

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE_DIR = join(ROOT, '.playwright-profile');
const ENV_FILE = join(ROOT, '.env');

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function writeEnv(key, region) {
  let existing = '';
  if (await fileExists(ENV_FILE)) existing = await readFile(ENV_FILE, 'utf8');
  const lines = existing.split('\n').filter(
    (l) => !l.startsWith('AZURE_SPEECH_KEY=') && !l.startsWith('AZURE_SPEECH_REGION='),
  );
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push(`AZURE_SPEECH_KEY=${key}`);
  lines.push(`AZURE_SPEECH_REGION=${region}`);
  await writeFile(ENV_FILE, lines.join('\n') + '\n');
  log(`✅ Wrote AZURE_SPEECH_KEY + AZURE_SPEECH_REGION to ${ENV_FILE}`);
}

// Look for a 32+ char hex/alphanumeric string anywhere in the page.
async function tryExtractKey(page) {
  const result = await page
    .evaluate(() => {
      const hits = [];
      // Try input values first (most reliable)
      for (const el of document.querySelectorAll('input')) {
        const v = el.value || '';
        if (v.length >= 32 && /^[a-zA-Z0-9]+$/.test(v)) hits.push(v);
      }
      // Fallback to text content of spans/code
      if (!hits.length) {
        for (const el of document.querySelectorAll('span, code, div')) {
          const t = (el.textContent || '').trim();
          if (t.length >= 32 && t.length <= 64 && /^[a-zA-Z0-9]+$/.test(t)) {
            hits.push(t);
          }
        }
      }
      return hits[0] || null;
    })
    .catch(() => null);
  return result;
}

async function tryExtractRegion(page) {
  // Look for known region codes / display names in the page text
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const map = {
    eastus: ['East US', 'eastus'],
    westus: ['West US', 'westus'],
    westus2: ['West US 2', 'westus2'],
    westus3: ['West US 3', 'westus3'],
    centralus: ['Central US', 'centralus'],
    northcentralus: ['North Central US', 'northcentralus'],
    southcentralus: ['South Central US', 'southcentralus'],
    eastus2: ['East US 2', 'eastus2'],
    westeurope: ['West Europe', 'westeurope'],
    northeurope: ['North Europe', 'northeurope'],
  };
  for (const [code, labels] of Object.entries(map)) {
    if (labels.some((l) => txt.includes(l))) return code;
  }
  return null;
}

async function main() {
  await mkdir(PROFILE_DIR, { recursive: true });

  log('🚀 Launching Chromium (visible window)...');
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  await page.goto('https://portal.azure.com/', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IN THE BROWSER — DO THIS (≈90 seconds):');
  console.log('');
  console.log('  1. Log in (MFA on phone if asked)');
  console.log('  2. Top search bar → type "Speech services" → click it');
  console.log('  3. + Create button');
  console.log('  4. Resource group: create new "language-learning-helper"');
  console.log('  5. Region: East US');
  console.log('  6. Name: langhelper-speech (add suffix if taken)');
  console.log('  7. Pricing tier: Free F0');
  console.log('  8. Review + Create → Create → wait for deploy');
  console.log('  9. Click "Go to resource" → left sidebar → "Keys and Endpoint"');
  console.log('  10. Click "Show keys" if needed');
  console.log('');
  console.log('  This script will detect KEY 1 automatically and write .env.');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  log('👀 Polling for Keys and Endpoint page every 3s (will wait up to 15 min)...');

  const deadline = Date.now() + 15 * 60 * 1000;
  let key = null;
  let region = null;
  while (Date.now() < deadline) {
    const url = page.url();
    const isKeysBlade =
      url.includes('keys') ||
      url.toLowerCase().includes('keysandendpoint') ||
      url.toLowerCase().includes('cognitiveservices');
    if (isKeysBlade) {
      key = await tryExtractKey(page);
      if (key) {
        region = (await tryExtractRegion(page)) ?? 'eastus';
        break;
      }
    }
    await page.waitForTimeout(3000);
  }

  if (!key) {
    log('❌ Timed out without finding KEY 1.');
    log('   Take the key manually from the portal and paste it into .env:');
    log(`   AZURE_SPEECH_KEY=...`);
    log(`   AZURE_SPEECH_REGION=eastus`);
    process.exitCode = 1;
  } else {
    log(`✅ Detected KEY 1: ${key.slice(0, 6)}…${key.slice(-4)}`);
    log(`✅ Detected region: ${region}`);
    await writeEnv(key, region);
    log('🎉 Done. You can close the browser.');
  }

  await page.waitForTimeout(3000);
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
