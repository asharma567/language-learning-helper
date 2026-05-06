// Copy VAD model + worklet + ONNX runtime WASM blobs into public/vad/ so
// they ship as static assets at https://langhelper.pages.dev/vad/...
//
// Run before build: `npm run vad:assets`. Idempotent.

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public/vad');

const targets = [
  // Silero v5 model + audio worklet from vad-web
  { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx', dst: 'silero_vad_v5.onnx' },
  { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx', dst: 'silero_vad_legacy.onnx' },
  { src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dst: 'vad.worklet.bundle.min.js' },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  // Copy explicit files
  for (const t of targets) {
    const src = join(ROOT, t.src);
    const dst = join(OUT, t.dst);
    await copyFile(src, dst);
    console.log(`✓ ${t.dst}`);
  }

  // Copy ONLY the wasm-simd-threaded variant ort-web uses by default for
  // CPU inference. webgpu/webgl/jspi/asyncify variants are huge and unused.
  const ortDir = join(ROOT, 'node_modules/onnxruntime-web/dist');
  const ORT_KEEP = [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort.wasm.min.mjs',
    'ort.wasm.mjs',
  ];
  for (const f of ORT_KEEP) {
    try {
      await copyFile(join(ortDir, f), join(OUT, f));
      console.log(`✓ ${f}`);
    } catch (e) {
      console.warn(`  (skipped ${f}: ${String(e).slice(0, 80)})`);
    }
  }

  console.log(`\nDone. ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
