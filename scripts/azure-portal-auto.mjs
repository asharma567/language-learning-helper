// Fully-automated Azure Speech resource setup.
//
// Key changes vs prior version:
// - Never use URL state for "logged in" detection. Wait for the portal search
//   bar (a stable DOM element) instead.
// - Multiple selector fallbacks for each form field.
// - Screenshot after every step into ./azure-debug/ so failures are diagnosable.
// - Stays open at the end so the user can see the final state.

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE_DIR = join(ROOT, '.playwright-profile');
const ENV_FILE = join(ROOT, '.env');
const DEBUG_DIR = join(ROOT, 'azure-debug');

const RESOURCE_NAME = 'langhelper-speech';
const RESOURCE_GROUP = 'language-learning-helper';
const REGION_DISPLAY = 'East US';
const REGION_CODE = 'eastus';

let stepCounter = 0;
function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}
async function snap(page, label) {
  stepCounter += 1;
  const name = `${String(stepCounter).padStart(2, '0')}-${label}.png`;
  await page
    .screenshot({ path: join(DEBUG_DIR, name), fullPage: false })
    .catch(() => {});
  log(`📸 ${name}`);
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
  log(`✅ Wrote .env`);
}

// Wait for portal to be loaded — use a stable, portal-only DOM element.
async function waitForPortalReady(page) {
  log('⏳ Waiting for portal to load (search bar to appear)...');
  await page.waitForSelector(
    'input[placeholder*="Search resources"], input[aria-label*="Search resources"]',
    { timeout: 5 * 60 * 1000 },
  );
  // Extra settle time
  await page.waitForTimeout(2000);
  log('✅ Portal ready.');
}

async function clickFirstVisible(page, selectors, opts = {}) {
  const { timeout = 15000, label = 'click' } = opts;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = typeof sel === 'string' ? page.locator(sel) : sel;
        const first = loc.first();
        if (await first.isVisible({ timeout: 1000 })) {
          await first.click({ timeout: 5000 });
          return true;
        }
      } catch {
        // try next
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Could not click any of: ${label}`);
}

async function fillFirstVisible(page, selectors, value, opts = {}) {
  const { timeout = 15000, label = 'fill' } = opts;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = typeof sel === 'string' ? page.locator(sel) : sel;
        const first = loc.first();
        if (await first.isVisible({ timeout: 1000 })) {
          await first.fill(value, { timeout: 5000 });
          return true;
        }
      } catch {
        // try next
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Could not fill any of: ${label}`);
}

async function searchForSpeechServices(page) {
  log('🔎 Opening Speech services...');
  // Direct deep-link is more reliable than driving the search bar.
  await page.goto(
    'https://portal.azure.com/#browse/Microsoft.CognitiveServices%2Faccounts',
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForTimeout(4000);
  await snap(page, 'speech-services-list');
}

async function openCreateForm(page) {
  log('➕ Opening create form...');
  await page.goto(
    'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
    { waitUntil: 'domcontentloaded' },
  );
  // The create blade takes a while to spin up
  await page.waitForTimeout(10000);
  await snap(page, 'create-form-loaded');
}

async function fillCreateForm(page) {
  // Resource group: try "Create new" link
  log('  • Resource group → create new');
  try {
    await clickFirstVisible(
      page,
      [
        'a:has-text("Create new")',
        'button:has-text("Create new")',
      ],
      { timeout: 8000, label: 'Resource group / Create new' },
    );
    await page.waitForTimeout(1000);
    await fillFirstVisible(
      page,
      [
        'input[aria-label*="resource group" i][type="text"]',
        '[role="dialog"] input[type="text"]',
      ],
      RESOURCE_GROUP,
      { timeout: 8000, label: 'New RG name' },
    );
    await page.waitForTimeout(500);
    await clickFirstVisible(
      page,
      ['button:has-text("OK")', '[role="dialog"] button:has-text("OK")'],
      { timeout: 5000, label: 'OK on RG dialog' },
    );
    await page.waitForTimeout(2000);
  } catch (e) {
    log(`  (RG step soft-fail: ${e.message})`);
  }
  await snap(page, 'after-rg');

  // Region
  log(`  • Region → ${REGION_DISPLAY}`);
  try {
    await clickFirstVisible(
      page,
      [
        'div[aria-label*="Region" i]',
        '[role="combobox"][aria-label*="Region" i]',
        'select[aria-label*="Region" i]',
      ],
      { timeout: 10000, label: 'Region combo' },
    );
    await page.waitForTimeout(1000);
    await clickFirstVisible(
      page,
      [
        `[role="option"]:has-text("${REGION_DISPLAY}")`,
        `li:has-text("${REGION_DISPLAY}")`,
        `div[role="treeitem"]:has-text("${REGION_DISPLAY}")`,
      ],
      { timeout: 8000, label: 'Region option' },
    );
    await page.waitForTimeout(1000);
  } catch (e) {
    log(`  (Region step soft-fail: ${e.message})`);
  }
  await snap(page, 'after-region');

  // Name
  log(`  • Name → ${RESOURCE_NAME}`);
  try {
    await fillFirstVisible(
      page,
      [
        'input[aria-label="Name"]',
        'input[aria-label*="Name" i]:not([aria-label*="Resource group" i])',
      ],
      RESOURCE_NAME,
      { timeout: 10000, label: 'Name input' },
    );
    await page.waitForTimeout(1000);
  } catch (e) {
    log(`  (Name step soft-fail: ${e.message})`);
  }
  await snap(page, 'after-name');

  // Pricing tier
  log('  • Pricing tier → Free F0');
  try {
    await clickFirstVisible(
      page,
      [
        'div[aria-label*="Pricing tier" i]',
        '[role="combobox"][aria-label*="Pricing" i]',
      ],
      { timeout: 8000, label: 'Pricing combo' },
    );
    await page.waitForTimeout(1000);
    await clickFirstVisible(
      page,
      [
        '[role="option"]:has-text("Free F0")',
        '[role="option"]:has-text("F0")',
        'li:has-text("Free F0")',
        'div[role="treeitem"]:has-text("Free F0")',
      ],
      { timeout: 5000, label: 'Free F0 option' },
    );
    await page.waitForTimeout(1000);
  } catch (e) {
    log(`  (Pricing step soft-fail — Free F0 may already be default: ${e.message})`);
  }
  await snap(page, 'after-pricing');

  // Responsible AI checkbox (sometimes appears)
  try {
    const respAi = page.locator(
      'input[type="checkbox"][aria-label*="Responsible AI" i], input[type="checkbox"][aria-label*="have read" i]',
    );
    if (await respAi.first().isVisible({ timeout: 2000 })) {
      await respAi.first().check();
      log('  • Responsible AI checkbox checked');
    }
  } catch {
    // not present
  }

  // Review + Create
  log('  • Review + Create');
  await clickFirstVisible(
    page,
    [
      'button:has-text("Review + create")',
      'button[aria-label*="Review" i][aria-label*="create" i]',
    ],
    { timeout: 15000, label: 'Review + Create button' },
  );
  await page.waitForTimeout(8000);
  await snap(page, 'after-review');

  // Final Create
  log('  • Create (final submit)');
  await clickFirstVisible(
    page,
    [
      'button[aria-label="Create" i]:not(:has-text("Review"))',
      'button:has-text("Create"):not(:has-text("Review"))',
    ],
    { timeout: 30000, label: 'Final Create button' },
  );
  log('  • Submitted. Waiting for deployment...');
  await snap(page, 'after-submit');
}

async function waitForDeploymentAndOpen(page) {
  // Wait for "Your deployment is complete" or "Go to resource" button
  await Promise.race([
    page.locator('text=/your deployment is complete/i').waitFor({ timeout: 5 * 60 * 1000 }),
    page.locator('button:has-text("Go to resource")').waitFor({ timeout: 5 * 60 * 1000 }),
  ]);
  await snap(page, 'deployment-complete');
  log('✅ Deployment complete');

  // Click Go to resource
  await clickFirstVisible(
    page,
    ['button:has-text("Go to resource")', 'a:has-text("Go to resource")'],
    { timeout: 30000, label: 'Go to resource' },
  );
  await page.waitForTimeout(5000);
  await snap(page, 'resource-overview');
}

async function openKeysAndExtract(page) {
  log('🔑 Opening Keys and Endpoint...');
  await clickFirstVisible(
    page,
    [
      'a:has-text("Keys and Endpoint")',
      'div[role="treeitem"]:has-text("Keys and Endpoint")',
      'a[href*="keys"]:has-text("Keys")',
    ],
    { timeout: 30000, label: 'Keys and Endpoint nav' },
  );
  await page.waitForTimeout(5000);
  await snap(page, 'keys-blade');

  // Click "Show keys" if present
  try {
    await clickFirstVisible(
      page,
      ['button:has-text("Show keys")', 'button:has-text("Show Keys")'],
      { timeout: 4000, label: 'Show keys' },
    );
    await page.waitForTimeout(1500);
  } catch {
    // already shown
  }
  await snap(page, 'keys-revealed');

  log('  • Extracting KEY 1...');
  const key = await page
    .evaluate(() => {
      // Try inputs first
      for (const el of document.querySelectorAll('input')) {
        const v = el.value || '';
        if (v.length >= 32 && /^[a-zA-Z0-9]+$/.test(v)) return v;
      }
      // Fallback to text content
      for (const el of document.querySelectorAll('span, code, div')) {
        const t = (el.textContent || '').trim();
        if (t.length >= 32 && t.length <= 64 && /^[a-zA-Z0-9]+$/.test(t)) return t;
      }
      return null;
    })
    .catch(() => null);

  if (!key) {
    throw new Error('KEY 1 not found in DOM. Check screenshots.');
  }
  log(`  • KEY 1: ${key.slice(0, 6)}…${key.slice(-4)}`);
  return { key, region: REGION_CODE };
}

async function main() {
  await mkdir(PROFILE_DIR, { recursive: true });
  await mkdir(DEBUG_DIR, { recursive: true });

  log('🚀 Launching Chromium...');
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1500, height: 950 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    await page.goto('https://portal.azure.com/', { waitUntil: 'domcontentloaded' });
    await waitForPortalReady(page);
    await snap(page, 'portal-ready');

    await searchForSpeechServices(page);

    // If resource already exists, jump straight to it
    const existing = page.locator(`a:has-text("${RESOURCE_NAME}")`);
    let alreadyExists = false;
    try {
      if (await existing.first().isVisible({ timeout: 4000 })) {
        log(`✅ Resource "${RESOURCE_NAME}" already exists. Opening it.`);
        await existing.first().click();
        await page.waitForTimeout(5000);
        alreadyExists = true;
      }
    } catch {
      // no existing
    }

    if (!alreadyExists) {
      await openCreateForm(page);
      await fillCreateForm(page);
      await waitForDeploymentAndOpen(page);
    }

    const { key, region } = await openKeysAndExtract(page);
    await writeEnv(key, region);
    log('🎉 Done. Browser staying open 10s so you can verify.');
    await page.waitForTimeout(10000);
  } catch (err) {
    log(`❌ Failed: ${err.message}`);
    await snap(page, 'final-error');
    log(`Screenshots in: ${DEBUG_DIR}`);
    process.exitCode = 1;
    // Leave browser open longer on error so user can intervene
    await page.waitForTimeout(60000);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
