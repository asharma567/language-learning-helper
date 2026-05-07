# Code Standards

Conventions specific to this codebase. Most are unenforced by tooling — they're earned from real bugs and re-litigation. Break them only with a written reason.

## Astro islands pattern

- Pages are `.astro` files. Today there's one: `src/pages/index.astro`. It ships zero JS by default.
- The single React island is mounted via `<App client:only="react" />` in `index.astro:21`. We use `client:only` instead of `client:load` because every component below `App` requires `localStorage` / `MediaRecorder` / `AudioContext` — there's nothing to SSR.
- API routes live under `src/pages/api/**.ts`. Each must export `export const prerender = false;` (CF Pages adapter requirement for server endpoints).
- Don't add new `.astro` pages without a reason. The single-page-app shape is intentional — every screen lives in `App.tsx`'s state machine.

## Module system

- **ESM only.** `package.json` has `"type": "module"`. Use `.ts`, `.tsx`, `.mjs`, `.mts` — never `.cjs`.
- Imports use the `~/*` → `src/*` alias from `tsconfig.json` paths. Component code conventionally uses relative imports (`'../lib/lexicon'`); script code uses the alias when convenient.
- Top-level await is fine in scripts (`scripts/autoresearch/verify-quality.mjs`).

## Service interface pattern

Each browser-side service follows a strict shape:

```ts
// src/services/<name>.ts
export interface FooProvider { /* method shape */ }
const PROVIDERS = { azure: azureFoo, /* ... */ } as const;
let active: FooProvider = PROVIDERS.azure;
export function setFooProvider(name: keyof typeof PROVIDERS): void { active = PROVIDERS[name]; }
export const doFoo = (...args) => active.method(...args);
```

Examples: `src/services/tts.ts`, `src/services/pronunciation.ts`, `src/services/translation.ts`.

**Why:** When we swap providers (Azure → ElevenLabs, OpenAI → Anthropic), we change ONE factory line. Components import the convenience export (`speak`, `assessPronunciation`, `translatePhrase`) and never reach into a provider directly. Don't bypass this — even when there's "only one" provider today.

Provider implementations live in `src/services/providers/<name>-<service>.ts` (e.g. `azure-tts.ts`, `web-speech-tts.ts`).

## Module organization

- **`src/lib/`** = pure logic + tests. NO `fetch` from the browser context (server-side modules like `azure-speech.ts` and `elevenlabs-tts.ts` may fetch — they only run in API routes / scripts). NO `localStorage` / `window` access except via the `storage.ts` shim. Tests colocated as `<name>.test.ts`.
- **`src/services/`** = browser-side provider abstractions. THIS is where `fetch` to our own `/api/*` lives, plus localStorage caches.
- **`src/pages/api/`** = server endpoints. Each is a thin wrapper that pulls env vars (via `getEnv(locals, ...)` helper), validates the body, calls a `lib/` function, and shapes the response.
- **`src/components/`** = React. No `lib/` imports may pull in browser-only APIs at module scope (lazy via dynamic import if needed — see `azure-tutor-stream.ts:289` dynamic-importing `@ricky0123/vad-web` to keep it out of initial bundle).

## Tests

- Vitest, `*.test.ts` colocated with source. Examples: `src/lib/srs.test.ts`, `src/lib/grader.test.ts`, `src/lib/scenarios.test.ts`, `src/lib/session.test.ts`, `src/lib/quickmatch.test.ts`.
- Run with `npm test` (vitest run). Watch mode: `npm run test:watch`.
- Tests use `vi.stubGlobal('localStorage', ...)` to inject a fake store (see `session.test.ts:14`). Don't import the real `storage.ts` then call `loadProgress()` without stubbing — you'll pollute the dev environment.
- Regression tests are explicit: each one names the bug it locks in. Example: `srs.test.ts:99` — *"clamps due-item selection to the supplied scope (regression: scenario isolation)"*. Add a test like this when you fix any bug worth not re-introducing.
- See [Testing Guide](testing-guide.md) for the full pattern.

## No Cyrillic in display code

The UI is **phonetic-English only**. Cyrillic (`[Ѐ-ӿ]`) appears in user-visible strings in exactly one place: `ScoreFeedback.tsx:49` — `<div className="...">{display}</div>` — to show what the user just attempted in writing. It's also in `TutorCall.tsx:30` (`looksRussian`) for italics-vs-bold styling of transcript lines.

If you find yourself adding Cyrillic to a `<button>`, `<h1>`, or `<p>` outside this rule, stop. The whole point is to drill the *spoken* form. Reading Cyrillic is a different skill the user explicitly opted out of.

`src/data/lexicon.json` and `src/lib/azure-speech.ts` (etc.) carry Cyrillic in *data* — that's fine; it's the source of truth fed to TTS / Pronunciation Assessment.

## Tutor-stream NDJSON wire format

The `/api/tutor/turn-stream` endpoint sends newline-delimited JSON over a streaming HTTP response. Event types defined in `src/pages/api/tutor/turn-stream.ts:8-13`:

```json
{"type":"audio_chunk","seq":-1,"sentence":"<filler-slug>","audio_b64":"..."}
{"type":"user_transcript","text":"..."}
{"type":"audio_chunk","seq":0,"sentence":"...","audio_b64":"..."}
{"type":"audio_chunk","seq":1,"sentence":"...","audio_b64":"..."}
{"type":"done","tutor_full":"..."}
{"type":"tts_error","seq":2,"sentence":"...","message":"..."}
{"type":"error","message":"..."}
```

Conventions:
- `seq=-1` is reserved for the V1 optimistic filler (emitted BEFORE STT runs).
- `seq` starts at 0 for real Sveta sentences and increments by sentence boundary.
- `audio_b64` is base64-encoded mp3 (`audio/mpeg`). Client decodes via `atob`.
- The client may receive events in any order EXCEPT `audio_chunk` events whose `seq >= 0` arrive in strict order (enforced server-side by the `emitChain` Promise chain at `turn-stream.ts:149-189`). Client must play them in the order received.
- Both endpoints emit `tts_error` (per-sentence TTS failure, recoverable) and `error` (terminal). Client treats both as warnings; the conversation continues.
- Response headers: `content-type: application/x-ndjson`, `cache-control: no-cache, no-store`, `x-accel-buffering: no` (hints proxies not to buffer).

When adding a new event type, document it here AND in [API Reference](api-reference.md) AND extend `azure-tutor-stream.ts::streamTurn` to handle it.

## SSML voice-per-span builder pattern

`buildSsml(text)` in `src/lib/tutor-conversation.ts:235` is the single source of truth for tutor TTS markup. It:

1. Strips markdown (`stripMarkdownForTts` — handles `**bold**`, parenthesized phonetic guides like `(pree-VYET)`, em-dash phonetic tails).
2. Splits by language using `splitByLanguage` (Cyrillic vs Latin token classification).
3. Wraps each span in `<lang xml:lang='ru-RU'>` or `<lang xml:lang='en-US'>` inside ONE `<voice name='en-US-AvaMultilingualNeural'>` — Microsoft's flagship multilingual voice. ONE voice for both languages = no jagged accent transitions when Sveta code-switches mid-sentence.
4. Russian spans get `prosody rate='-6%'` (slower for learner clarity); English gets `-2%`.
5. Inserts a 120ms `<break>` between spans.

If you ever need to swap voices, do it ONLY here. The ElevenLabs path bypasses SSML entirely (ElevenLabs API takes plain text + voice settings).

## Env var access pattern

CF Pages exposes secrets through `locals.runtime.env`, while local dev (`npm run dev`) uses `process.env`. Every API route uses this helper:

```ts
function getEnv(locals: App.Locals | undefined, key: string): string | undefined {
  const fromProc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const fromRuntime = (locals as unknown as { runtime?: { env?: Record<string, string | undefined> } })?.runtime?.env?.[key];
  return fromRuntime ?? fromProc;
}
```

Pattern: runtime first, process.env fallback. Don't read `import.meta.env.X` for secrets — those are baked into the client bundle.

## State persistence

- All persistent client state goes through `src/lib/storage.ts`. Single key: `llh:v1:progress`. Shape: `{items: ItemState[], streak, stats}`.
- Translation cache: `translation-cache:v1` (separate key, separate concern). Cap 200 entries (oldest dropped).
- One-off UX flags: per-key (`driveModeSeen` in `Lesson.tsx:75`). These are scratch booleans, not protected.
- **Do NOT version-bump the `llh:v1:` key without a migration.** It will silently wipe months of SRS state for the user. Add a migration in `loadProgress` instead.

## Custom-entry escape hatch

The "Try any phrase" feature creates `LexiconEntry` objects with `id: custom-<base36-timestamp>`. The convention is: any ID starting with `custom-` is one-off, NOT in the SRS persistent store. `Lesson.tsx:47` checks `id.startsWith('custom-')` and skips `recordAttempt`. Don't repurpose this prefix.

## Latency optimization markers

The voice-tutor pipeline has comments tagged `[V1]`, `[V3]`, `[V4]`, `[V9]` keyed to autoresearch experiments. Find them with `rg '\[V[0-9]+\]' src/`. They mark intentional choices (parallel TTS chain, speculative Claude, inlined fillers) — if you "simplify" them you'll reintroduce 600ms+ of latency. The history is in commit messages `0362ab8`, `e5f08ce`, `ff87498`, `38b39ad`, `a163765`, `158a0ea`, `110f792`, and the autoresearch logs.

## Pronunciation Assessment gotchas

- Azure PA does **forced alignment**. `recognizedText` echoes the reference text — it's not what the user actually said. The truthful signal is `pronScore` (overall) + per-word `errorType`. The "heard:" line was removed from `ScoreFeedback` for this reason.
- Azure PA only scores **PCM audio**. Compressed webm/opus crashes with cryptic 400s. Always convert via `blobToPcmWav` (`src/services/audio-convert.ts:8`) before posting.

## Anthropic prompt cache: tried and reverted

Don't reintroduce `cache_control` on the Sveta system prompt without checking commit `b642699`. Haiku 4.5's minimum cache threshold (4096 tokens) is too high to clear without bloating the prompt past the break-even point.

## Manual deploys are the rule

CF Pages git auto-deploy webhook is currently broken. **Pushes to `main` do not deploy.** See [Deployment Guide](deployment-guide.md) for the manual `wrangler pages deploy` command. Add a CI alarm before relying on auto-deploy again.

## Cross-references

- Code standards above on the tutor stream + SSML feed into the [System Architecture](system-architecture.md) latency-pipeline diagrams.
- Test patterns + the regression-test convention live in detail at [Testing Guide](testing-guide.md).
