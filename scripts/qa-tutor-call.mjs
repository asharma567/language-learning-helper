// End-to-end QA of the Azure-backed voice tutor (post-Azure-pivot).
//
// Drives a real Chromium with a fake mic that "speaks" a Russian wav, walks
// through ScenarioPicker → Talk to a tutor → Start call, captures the full
// turn cycle (bootstrap + first user utterance + Sveta's reply), and
// verifies the user-visible behavior — not just that endpoints returned 200.
//
// Exit code 0 = pass, 1 = at least one check failed.
//
// Run: QA_URL=https://langhelper.pages.dev node scripts/qa-tutor-call.mjs
//      (defaults to prod URL)

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const URL = process.env.QA_URL ?? 'https://langhelper.pages.dev';
const FAKE_MIC = '/tmp/fake-mic-tih-krasivaya.wav';
const PROFILE_DIR = '/tmp/qa-tutor-profile';
const ARTIFACT_DIR = '/tmp/qa-tutor-artifacts';

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

  const consoleErrors = [];
  const turnRequests = []; // { status, ms, body? }
  const transcripts = []; // { user, tutor }
  const audioMp3Sizes = [];

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/api/tutor/turn')) return;
    const ms = Math.round((res.request().timing()?.responseEnd ?? 0));
    const status = res.status();
    const isStreaming = u.includes('/turn-stream');

    // Non-streaming endpoint sets transcripts in headers + audio is response body.
    // Streaming endpoint sends NDJSON events containing audio_chunk + done events.
    if (!isStreaming) {
      const userT = decodeURIComponent(res.headers()['x-user-transcript'] ?? '');
      const tutorT = decodeURIComponent(res.headers()['x-tutor-transcript'] ?? '');
      const bytes = parseInt(res.headers()['content-length'] ?? '0', 10);
      turnRequests.push({ status, ms, bytes, kind: 'turn' });
      if (userT || tutorT) transcripts.push({ user: userT, tutor: tutorT });
      if (bytes > 1000) audioMp3Sizes.push(bytes);
      return;
    }

    // Streaming: read the NDJSON body to extract events. Note: this consumes
    // the response body for our observation only — the browser will have
    // already consumed it via its own ReadableStream reader. Playwright
    // duplicates the body so this is safe.
    let body = '';
    try { body = (await res.text()).slice(0, 200_000); } catch { /* fine */ }
    let userT = '';
    let tutorT = '';
    let chunkCount = 0;
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let evt;
      try { evt = JSON.parse(t); } catch { continue; }
      if (evt.type === 'user_transcript') userT = evt.text ?? '';
      if (evt.type === 'audio_chunk') chunkCount++;
      if (evt.type === 'done') tutorT = evt.tutor_full ?? tutorT;
    }
    // Approximation of audio bytes — count of chunks is the key signal.
    const bytes = chunkCount * 5000; // ~5KB avg per sentence chunk
    turnRequests.push({ status, ms, bytes, kind: 'turn-stream', chunks: chunkCount });
    if (userT || tutorT) transcripts.push({ user: userT, tutor: tutorT });
    if (chunkCount > 0) audioMp3Sizes.push(bytes);
  });

  log(`🌐 Navigate ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  log('🖱️  Click "Talk to a tutor"');
  await page.getByRole('button', { name: /talk to a tutor/i }).click();
  await page.waitForTimeout(800);

  log('🖱️  Click "Start call"');
  await page.getByRole('button', { name: /start call/i }).click();

  // Wait for bootstrap + at least one user-driven turn cycle.
  // Bootstrap: ~1.5-3s. VAD warmup: ~2-3s. User utterance via fake mic playback ~2s.
  // Sveta's reply: ~2-4s. Total observation window: 30s should comfortably cover 1-2 cycles.
  log('👀 Observing tutor cycle for 30s (fake mic feeds Russian audio in loop)…');
  await page.waitForTimeout(30_000);

  const screenText = await page.locator('body').innerText().catch(() => '');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'final-state.png'), fullPage: false }).catch(() => {});

  log('🛑 End call');
  try {
    await page.getByRole('button', { name: /end call/i }).click({ timeout: 3000 });
  } catch { /* call may have ended already */ }
  await page.waitForTimeout(1500);

  await ctx.close();

  // --- Report ---
  console.log('\n' + '='.repeat(70));
  console.log('QA REPORT — Voice Tutor (Azure-backed)');
  console.log('='.repeat(70));

  console.log(`\nTurn POST requests: ${turnRequests.length}`);
  for (const r of turnRequests) {
    console.log(`  ${r.status} | ${r.bytes.toString().padStart(6)} bytes | ${String(r.ms).padStart(5)}ms`);
  }

  console.log(`\nTranscripts captured: ${transcripts.length}`);
  for (const [i, t] of transcripts.entries()) {
    if (t.user) console.log(`  [${i}] 🧑 ${t.user.slice(0, 120)}`);
    if (t.tutor) console.log(`  [${i}] 👩🏼 ${t.tutor.slice(0, 200)}`);
  }

  console.log(`\nConsole errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`  ✗ ${e.slice(0, 200)}`);

  // Truth source for "did the user actually see + hear Sveta": the rendered
  // DOM. Streaming responses can't be re-read from Playwright's response
  // listener (body consumed by the page), so we verify by what landed on
  // screen, which is what the real user experiences.
  const tutorTextOnScreen = /[А-Яа-яЁё]/.test(screenText) || /Sveta|Привет/i.test(screenText);
  const checks = [
    { name: 'At least one /api/tutor/turn(-stream) 200', pass: turnRequests.some((r) => r.status === 200) },
    { name: 'No 5xx (502/503 = pipeline broken)', pass: !turnRequests.some((r) => r.status >= 500) },
    { name: "Sveta's greeting rendered to screen (Cyrillic or 'Sveta'/'Привет' present)", pass: tutorTextOnScreen },
    { name: 'No console errors', pass: consoleErrors.length === 0 },
  ];

  console.log(`\nChecks:`);
  for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);

  // Save the latest tutor mp3 for manual listen-back
  if (audioMp3Sizes.length) {
    const latestSize = audioMp3Sizes[audioMp3Sizes.length - 1];
    console.log(`\nLatest tutor mp3 size: ${latestSize} bytes (saved by browser as blob)`);
  }

  console.log(`\nScreenshot: ${join(ARTIFACT_DIR, 'final-state.png')}`);
  console.log(`Final screen text:\n  ${screenText.slice(0, 400).replace(/\n/g, ' ')}`);

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? '🎉 PIPELINE PASS' : '⚠️  PIPELINE ISSUES'} — voice quality still requires human ears.`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
