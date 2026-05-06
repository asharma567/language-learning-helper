// Latency harness for the STREAMING /api/tutor/turn-stream endpoint.
// Measures TIME-TO-FIRST-AUDIO-CHUNK (the perceived latency) and total time.
// Use alongside measure-tutor-latency.mjs to compare streaming vs non-streaming.

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const URL = process.env.HARNESS_URL ?? 'http://localhost:4327/api/tutor/turn-stream';
const TRIALS = parseInt(process.env.HARNESS_TRIALS ?? '3', 10);
const AUDIO = process.env.HARNESS_AUDIO ?? '/tmp/fake-mic-tih-krasivaya.wav';
const HISTORY = [{ role: 'assistant', text: "Try saying ты красивая." }];

async function trial() {
  const wav = await readFile(AUDIO);
  const fd = new FormData();
  fd.append('meta', JSON.stringify({
    scenarioId: 'approach-greet', history: HISTORY, bootstrap: false,
  }));
  fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'turn.wav');

  const t0 = performance.now();
  const res = await fetch(URL, { method: 'POST', body: fd });
  if (!res.ok || !res.body) {
    return { ttfa: -1, total: -1, status: res.status, sentences: 0 };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let firstAudioMs = -1;
  let sentences = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, idx).trim();
      pending = pending.slice(idx + 1);
      if (!line) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'audio_chunk') {
          if (firstAudioMs < 0) firstAudioMs = performance.now() - t0;
          sentences++;
        }
      } catch { /* skip */ }
    }
  }
  const total = performance.now() - t0;
  return { ttfa: firstAudioMs, total, status: res.status, sentences };
}

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  console.error(`harness (streaming): ${URL} × ${TRIALS} trials`);
  const results = [];
  for (let i = 0; i < TRIALS; i++) {
    const r = await trial();
    results.push(r);
    console.error(`  trial ${i + 1}: ttfa=${r.ttfa.toFixed(0)}ms total=${r.total.toFixed(0)}ms sentences=${r.sentences} status=${r.status}`);
  }
  const ttfas = results.filter((r) => r.status === 200 && r.ttfa > 0).map((r) => r.ttfa);
  const totals = results.filter((r) => r.status === 200).map((r) => r.total);
  if (ttfas.length === 0) {
    console.log(JSON.stringify({ error: 'no successful trials with audio', results }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    median_ttfa_ms: Math.round(pct(ttfas, 0.5)),
    p90_ttfa_ms: Math.round(pct(ttfas, 0.9)),
    median_total_ms: Math.round(pct(totals, 0.5)),
    n: ttfas.length, of: TRIALS,
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });
