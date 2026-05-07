# API Reference

Catalog of every server endpoint in `src/pages/api/`. All run on the CF Pages Worker (Astro `output: 'server'`); each module exports `export const prerender = false`.

## Authentication

None at the wire level. Every endpoint is publicly callable. Secrets are read server-side from `locals.runtime.env` (CF Pages secrets) — see [Configuration Guide](configuration-guide.md).

If a required key is unset, the endpoint returns `503 {error: "<key> not configured"}`.

---

## `POST /api/tutor/turn-stream`

**Primary** voice-tutor endpoint. Returns a streaming NDJSON response containing the user's transcript, audio chunks per Sveta sentence, and a final done event.

**File**: `src/pages/api/tutor/turn-stream.ts`

### Request

`Content-Type: multipart/form-data` with two fields:

| Field | Type | Description |
|---|---|---|
| `meta` | string (JSON) | `{scenarioId: ScenarioId, history: ChatTurn[], bootstrap?: boolean}` |
| `audio` | Blob | PCM wav (16kHz mono). Required unless `bootstrap=true`. |

`ChatTurn = {role: 'user' | 'assistant', text: string}`. `ScenarioId` is one of the 9 strings in `SCENARIOS` (see `src/lib/scenarios.ts`).

### Response

`200 OK`, `Content-Type: application/x-ndjson`, body is newline-delimited JSON events.

| Event | When | Shape |
|---|---|---|
| `audio_chunk` (seq=-1) | Emitted FIRST as V1 optimistic filler | `{type: 'audio_chunk', seq: -1, sentence: '<filler-slug>', audio_b64: '<base64 mp3>'}` |
| `user_transcript` | After STT completes | `{type: 'user_transcript', text: string}` |
| `audio_chunk` (seq=0..) | Per Sveta sentence, in strict seq order | `{type: 'audio_chunk', seq: number, sentence: string, audio_b64: '<base64 mp3>'}` |
| `tts_error` | If TTS for a sentence failed (recoverable) | `{type: 'tts_error', seq: number, sentence: string, message: string}` |
| `done` | Last event before stream close | `{type: 'done', tutor_full: string}` |
| `error` | Terminal error | `{type: 'error', message: string}` |

Filler slugs: `hmm`, `tak`, `aga`, `ponyatno`, `horosho` (`src/lib/tutor-fillers.ts:10`).

### Error responses

| Status | When | Body |
|---|---|---|
| 400 | Bad meta JSON, unknown scenarioId, missing audio on non-bootstrap | `{error: '...'}` |
| 503 | Required env var missing | `{error: 'Azure Speech not configured'}` etc. |

### Example (non-bootstrap turn)

```sh
curl -X POST http://localhost:4327/api/tutor/turn-stream \
  -F 'meta={"scenarioId":"approach-greet","history":[{"role":"assistant","text":"Try saying ты красивая."}],"bootstrap":false}' \
  -F 'audio=@/tmp/fake-mic-tih-krasivaya.wav;type=audio/wav' \
  -N
# {"type":"audio_chunk","seq":-1,"sentence":"hmm","audio_b64":"..."}
# {"type":"user_transcript","text":"ты красивая"}
# {"type":"audio_chunk","seq":0,"sentence":"Молодец!","audio_b64":"..."}
# {"type":"audio_chunk","seq":1,"sentence":"Now try ты умная.","audio_b64":"..."}
# {"type":"done","tutor_full":"Молодец! Now try ты умная."}
```

Bootstrap turn: pass `bootstrap: true`, omit the audio Blob, history empty.

---

## `POST /api/tutor/turn`

Non-streaming variant of the above. Legacy, kept for fallback. Same request shape; response is a single `audio/mpeg` body with transcripts in headers.

**File**: `src/pages/api/tutor/turn.ts`

### Response

`200 OK`, `Content-Type: audio/mpeg`. Body is the entire mp3 (Sveta's full reply, single Azure SSML synthesis).

Headers:
- `x-user-transcript`: URL-encoded user transcript
- `x-tutor-transcript`: URL-encoded Sveta reply
- `access-control-expose-headers: x-user-transcript, x-tutor-transcript`

### Differences from `turn-stream`

- No filler emit.
- No speculative Claude.
- Single TTS call at the end.
- Full reply latency = STT + Claude (non-streaming) + TTS. ~3-4× slower TTFA than the streaming endpoint.

Used today only by `src/services/azure-tutor.ts` (push-to-talk legacy session). Production uses `turn-stream` exclusively.

---

## `POST /api/azure-tts`

TTS proxy. Takes plain text + voice name, returns mp3.

**File**: `src/pages/api/azure-tts.ts`

### Request

`Content-Type: application/json`, body:

```json
{ "text": "привет", "voice": "ru-RU-SvetlanaNeural" }
```

`voice` is optional; defaults to `ru-RU-SvetlanaNeural`. Allowed voices (whitelist at `azure-tts.ts:6-13`): `ru-RU-SvetlanaNeural`, `ru-RU-DmitryNeural`, `ru-RU-DariyaNeural`, `en-US-JennyNeural`, `en-US-AriaNeural`, `en-US-GuyNeural`. Unknown voices fall back to the default (no error).

### Response

`200 OK`, `Content-Type: audio/mpeg`, `Cache-Control: public, max-age=86400`. Body is the mp3 (24kHz/48kbps).

### Errors

- `400` invalid JSON / missing text
- `500` Azure key not configured
- `502` Azure TTS request failed

### Used by

`src/services/providers/azure-tts.ts:36` (`fetchLiveAudio`) — the live-fetch fallback when a phrase isn't in the pregenerated audio manifest.

---

## `POST /api/azure-pronounce`

Pronunciation Assessment proxy. Takes recorded audio + reference text, returns rich per-phoneme + per-word + overall scores.

**File**: `src/pages/api/azure-pronounce.ts`

### Request

`Content-Type: multipart/form-data`:

| Field | Type | Description |
|---|---|---|
| `audio` | Blob | PCM wav, 16kHz mono. **Required** — Azure PA only scores PCM. |
| `referenceText` | string | The Russian text the user was trying to say. |

If you send compressed audio (webm/opus), Azure returns cryptic 400s. Use `src/services/audio-convert.ts::blobToPcmWav` to convert.

### Response

`200 OK`, `Content-Type: application/json`. Shape:

```ts
{
  recognizedText: string;     // forced-alignment echo of referenceText (NOT what user said)
  accuracy: number;           // 0-100
  fluency: number;            // 0-100
  completeness: number;       // 0-100
  prosody: number | null;     // 0-100, null if Azure didn't return it
  pronScore: number;          // 0-100 — the overall signal
  words: Array<{
    word: string;
    accuracy: number;
    errorType: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion';
    phonemes: Array<{phoneme: string; accuracy: number}>;
  }>;
}
```

### Errors

- `400` missing audio or referenceText
- `500` Azure key not configured
- `502` Azure request failed (usually = wrong audio format)

### Used by

`src/services/providers/azure-pronunciation.ts:11`. Flow: `Lesson.tsx` records → `blobToPcmWav` → `assessPronunciation` (service) → POSTs here → grader maps to SRS.

---

## `POST /api/translate-phrase`

OpenAI-first / Anthropic-fallback translation orchestrator for the "Try any phrase" feature.

**File**: `src/pages/api/translate-phrase.ts`

### Request

`Content-Type: application/json`:

```json
{ "en": "do you want to grab a drink later?" }
```

`en` ≤ 200 chars.

### Response

`200 OK`, `Content-Type: application/json`:

```ts
{
  ru: string;          // Cyrillic translation
  phonetic: string;    // Latin romanization with stress UPPERCASE
  notes?: string;      // Optional one-line gender/register hint
  provider: 'openai' | 'anthropic';   // Which LLM actually answered
  usage: {/* per-provider token counts */};
}
```

Translation discipline lives in the shared SYSTEM_PROMPT (`src/lib/translation/types.ts:21`): casual `ты`-form, address-a-woman defaults for compliments, JSON-only output.

### Errors

- `400` invalid JSON, missing en, en too long
- `503` no provider configured (`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` both unset)
- `503 {error: 'all configured providers failed', openai?: {...}, anthropic?: {...}}` — both provider attempts failed; per-provider status + detail returned for self-diagnosis.

### Fallback behavior

1. If `OPENAI_API_KEY` set: try `gpt-4o-mini` (`response_format: json_object`, temp 0.2).
2. If OpenAI fails or unset, try Anthropic Haiku 4.5 (temp 0.2, max_tokens 128).
3. If both fail, 503 with both error details.

Quota note: OpenAI is currently exhausted but the key is kept set so the orchestrator's fallback path works on every request. To force Anthropic always, delete the `OPENAI_API_KEY` secret.

---

## Endpoints that DO NOT exist

- ~~`GET /api/transcribe`~~ — was the OpenAI Whisper proxy in v0 (pre-Azure pivot, pre-tutor). Deleted along with the Whisper grader. The old README at the root references it; ignore that line. Confirmed not present in `src/pages/api/`.

---

## Cross-references

- Env vars these endpoints read: [Configuration Guide](configuration-guide.md).
- Conventions for the streaming NDJSON wire format: [Code Standards](code-standards.md#tutor-stream-ndjson-wire-format).
- Pipeline diagrams that show how endpoints chain: [System Architecture](system-architecture.md).
- Latency harnesses that probe these endpoints: [Testing Guide](testing-guide.md).
