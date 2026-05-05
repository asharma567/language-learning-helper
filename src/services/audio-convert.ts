// Convert a MediaRecorder Blob (webm/opus, mp4/aac, etc.) to a 16 kHz mono
// PCM wav Blob. Required for Azure Pronunciation Assessment — Azure's STT
// can transcribe compressed audio fine, but its PA scoring pipeline only
// runs on raw PCM.

const TARGET_SR = 16000;

export async function blobToPcmWav(blob: Blob): Promise<Blob> {
  const arr = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arr.slice(0));
  } finally {
    decodeCtx.close().catch(() => {});
  }

  // Mix to mono and resample to TARGET_SR with an OfflineAudioContext.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SR), TARGET_SR);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  const pcm = rendered.getChannelData(0);
  return encodeWav(pcm, TARGET_SR);
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true);          // bits per sample
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
