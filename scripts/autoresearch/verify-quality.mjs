// Quality gate companion for measure-tutor-latency-stream.mjs.
// Runs ONE turn and fails (exit 1) if Claude returned empty content.
// Use BEFORE the latency harness to ensure metric isn't being gamed by
// a broken pipeline (e.g. a model swap that returns empty so only the
// filler counts as audio).
import { readFile } from 'node:fs/promises';
const URL = process.env.HARNESS_URL ?? 'http://localhost:4327/api/tutor/turn-stream';
const wav = await readFile(process.env.HARNESS_AUDIO ?? '/tmp/fake-mic-tih-krasivaya.wav');
const fd = new FormData();
fd.append('meta', JSON.stringify({
  scenarioId: 'approach-greet',
  history: [{ role: 'assistant', text: "Try saying ты красивая." }],
  bootstrap: false,
}));
fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'turn.wav');
const res = await fetch(URL, { method: 'POST', body: fd });
const reader = res.body.getReader();
const decoder = new TextDecoder();
let pending = '', tutorFull = '';
while (true) {
  const { value, done } = await reader.read(); if (done) break;
  pending += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, idx).trim(); pending = pending.slice(idx + 1);
    if (!line) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'done') tutorFull = evt.tutor_full ?? '';
    } catch {}
  }
}
if (!tutorFull || tutorFull.length < 20) {
  console.error(`QUALITY FAIL: Claude returned ${tutorFull.length} chars: ${JSON.stringify(tutorFull)}`);
  process.exit(1);
}
console.error(`Quality OK (${tutorFull.length} chars): ${tutorFull.slice(0, 100)}...`);
