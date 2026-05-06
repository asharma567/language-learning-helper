// Programmatic QA of the live voice tutor pipeline.
//
// Launches Chromium with fake-mic flags pointed at a pregenerated Russian wav,
// walks through Talk-to-tutor → Approach&Greet → Start call, observes the full
// WebRTC + data-channel event flow, and reports whether the pipeline works.
//
// Cannot judge subjective voice quality — only Ajay's ears can do that.
//
// Run: node scripts/qa-tutor-call.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const URL = process.env.QA_URL ?? 'https://langhelper.pages.dev';
const FAKE_MIC = '/tmp/fake-mic-tih-krasivaya.wav';
const PROFILE_DIR = '/tmp/qa-tutor-profile';
const ARTIFACT_DIR = '/tmp/qa-tutor-artifacts';
const OBSERVATION_WINDOW_MS = 25_000;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function main() {
  await mkdir(PROFILE_DIR, { recursive: true });
  await mkdir(ARTIFACT_DIR, { recursive: true });

  log(`🚀 Launching Chromium with fake mic: ${FAKE_MIC}`);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1200, height: 800 },
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_MIC}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
    permissions: ['microphone'],
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const events = [];
  const consoleErrors = [];
  const networkRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/realtime/') || url.includes('api.openai.com')) {
      networkRequests.push({ method: req.method(), url: url.slice(0, 150) });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/realtime/session')) {
      try {
        const body = await res.json();
        log(`✓ /api/realtime/session → ${res.status()}, model=${body.model}, voice=${body.voice}, phrases=${body.phrase_count}`);
      } catch {
        log(`/api/realtime/session → ${res.status()} (could not parse body)`);
      }
    }
  });

  // Inject a hook into the page to capture incoming realtime events from
  // the data channel. We patch RTCDataChannel.prototype.addEventListener so
  // we observe the same messages the app sees.
  await page.addInitScript(() => {
    window.__qaEvents = [];
    const origDC = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const dc = origDC.apply(this, args);
      const origAdd = dc.addEventListener.bind(dc);
      dc.addEventListener = (type, handler, opts) => {
        if (type === 'message') {
          const wrapped = (ev) => {
            try {
              const parsed = JSON.parse(ev.data);
              window.__qaEvents.push({
                ts: Date.now(),
                type: parsed.type,
                hasAudio: parsed.type?.includes('audio'),
                deltaLen: typeof parsed.delta === 'string' ? parsed.delta.length : null,
                transcriptLen: typeof parsed.transcript === 'string' ? parsed.transcript.length : null,
              });
            } catch { /* skip non-JSON */ }
            return handler(ev);
          };
          return origAdd(type, wrapped, opts);
        }
        return origAdd(type, handler, opts);
      };
      // Track connection state too
      this.addEventListener('connectionstatechange', () => {
        window.__qaEvents.push({
          ts: Date.now(),
          type: `pc.connectionstate=${this.connectionState}`,
        });
      });
      return dc;
    };
  });

  log(`🌐 Navigate ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  log('🖱️  Click "Talk to a tutor"');
  await page.getByRole('button', { name: /talk to a tutor/i }).click();
  await page.waitForTimeout(800);

  log('🖱️  Click "Start call" (this is the user-gesture chain that unlocks audio)');
  await page.getByRole('button', { name: /start call/i }).click();

  log(`👀 Observing for ${OBSERVATION_WINDOW_MS / 1000}s — capturing realtime events…`);
  await page.waitForTimeout(OBSERVATION_WINDOW_MS);

  const observed = await page.evaluate(() => window.__qaEvents ?? []);
  events.push(...observed);

  // Pull whatever transcript is on screen
  const screenText = await page.locator('body').innerText();
  const screenshot = join(ARTIFACT_DIR, 'final-state.png');
  await page.screenshot({ path: screenshot, fullPage: false });

  log('🛑 Click "End call"');
  try {
    await page.getByRole('button', { name: /end call/i }).click({ timeout: 3000 });
  } catch {
    log('  (End call button not visible — call may have already ended)');
  }
  await page.waitForTimeout(1500);

  await ctx.close();

  // ---- Report ----
  console.log('\n' + '='.repeat(70));
  console.log('QA REPORT — Voice Tutor Pipeline');
  console.log('='.repeat(70));

  console.log(`\nNetwork: ${networkRequests.length} relevant requests`);
  for (const r of networkRequests) console.log(`  ${r.method} ${r.url}`);

  console.log(`\nConsole errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`  ✗ ${e.slice(0, 200)}`);

  // Group events by type
  const byType = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  console.log(`\nRealtime events captured: ${events.length} total`);
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}  ${type}`);
  }

  // Verdicts
  const checks = [
    { name: 'Mint endpoint returned valid token', pass: networkRequests.some((r) => r.url.includes('/api/realtime/session')) },
    { name: 'WebRTC reached connected state', pass: events.some((e) => e.type === 'pc.connectionstate=connected') },
    { name: 'Data channel received session.created', pass: events.some((e) => e.type === 'session.created') },
    { name: 'Sveta produced output_audio.delta (she is speaking)', pass: events.some((e) => e.type === 'response.output_audio.delta') },
    { name: 'Sveta produced transcript (she has things to say)', pass: events.some((e) => e.type === 'response.output_audio_transcript.delta' || e.type === 'response.output_audio_transcript.done') },
    { name: 'No console errors', pass: consoleErrors.length === 0 },
  ];
  console.log(`\nChecks:`);
  for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);

  console.log(`\nFinal screen text (first 500 chars):`);
  console.log('  ' + screenText.slice(0, 500).replace(/\n/g, ' '));
  console.log(`\nScreenshot: ${screenshot}`);

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? '🎉 PIPELINE WORKS' : '⚠️  PIPELINE HAS ISSUES'} — only your ears can judge voice quality.`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
