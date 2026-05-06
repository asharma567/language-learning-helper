// Latency harness for /api/tutor/turn. Replays a fixed user turn N times,
// reports median + p90 wall-clock latency. Intended to drive the autoresearch
// loop on src/lib/tutor-conversation.ts + src/pages/api/tutor/turn.ts.
//
// Run: node scripts/autoresearch/measure-tutor-latency.mjs
//
// Requires the local dev server (npm run dev) to be running at :4327 with
// AZURE_SPEECH_KEY + ANTHROPIC_API_KEY in env.

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const URL = process.env.HARNESS_URL ?? 'http://localhost:4327/api/tutor/turn';
const TRIALS = parseInt(process.env.HARNESS_TRIALS ?? '3', 10);
const AUDIO = process.env.HARNESS_AUDIO ?? '/tmp/fake-mic-tih-krasivaya.wav';

// Single canonical conversation state — keeps experiments comparable.
// (Sveta just asked the user to repeat ты красивая; we send a wav of "ты красивая".)
const HISTORY = [
  { role: 'assistant', text: "Try saying ты красивая." },
];

async function trial() {
  const wav = await readFile(AUDIO);
  const fd = new FormData();
  fd.append('meta', JSON.stringify({
    scenarioId: 'approach-greet',
    history: HISTORY,
    bootstrap: false,
  }));
  fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'turn.wav');

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(URL, { method: 'POST', body: fd });
  } catch (err) {
    return { ttfb: -1, total: -1, status: 0, error: String(err) };
  }
  const ttfb = performance.now() - t0;
  const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
  const total = performance.now() - t0;
  return { ttfb, total, status: res.status, bytes: buf.byteLength };
}

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  console.error(`harness: ${URL} × ${TRIALS} trials`);
  const results = [];
  for (let i = 0; i < TRIALS; i++) {
    const r = await trial();
    results.push(r);
    console.error(`  trial ${i + 1}: total=${r.total.toFixed(0)}ms ttfb=${r.ttfb.toFixed(0)}ms status=${r.status}${r.error ? ` ERR=${r.error.slice(0, 60)}` : ''}`);
  }

  const totals = results.filter((r) => r.status >= 200 && r.status < 300).map((r) => r.total);
  if (totals.length === 0) {
    console.log(JSON.stringify({ error: 'no successful trials', results }));
    process.exit(1);
  }
  const median_ms = Math.round(pct(totals, 0.5));
  const p90_ms = Math.round(pct(totals, 0.9));
  const min_ms = Math.round(Math.min(...totals));
  const max_ms = Math.round(Math.max(...totals));
  // STDOUT = single JSON line, machine-readable
  console.log(JSON.stringify({ median_ms, p90_ms, min_ms, max_ms, n: totals.length, of: TRIALS }));
}

main().catch((e) => { console.error(e); process.exit(1); });
