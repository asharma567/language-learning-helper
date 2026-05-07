# Codebase Summary

A file-by-file inventory grouped by responsibility. All paths are relative to the repo root. Line numbers are stable on `main` as of this doc's writing — `wc -l` to confirm.

## Top-level

| File | Purpose |
|---|---|
| `astro.config.mjs` | Astro config: `output: 'server'`, `@astrojs/cloudflare` adapter with `platformProxy.enabled` (so `wrangler` env vars surface in dev), React + Tailwind integrations, dev port 4327. |
| `tailwind.config.mjs` | Custom palette (navy 900/800/700, accent blue, arc tokens), `font-phonetic` (monospace), `bg-navy-gradient` background image. See `docs/design-spec.md`. |
| `tsconfig.json` | Extends `astro/tsconfigs/strict`. JSX = `react-jsx`. `~/*` alias for `src/*`. |
| `package.json` | Scripts: `dev`, `build`, `test`, `test:watch`, `tts:bakeoff`, `audio:pregenerate`, `vad:assets`. `prebuild` runs `vad:assets` automatically. |
| `.env.example` | Template for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`. ElevenLabs key is added separately (see [Configuration Guide](configuration-guide.md)). |

## `src/pages/` — Astro routes

| File | Purpose |
|---|---|
| `index.astro` | Single-page shell. Mounts `<App client:only="react" />`. Sets PWA manifest + apple-mobile-web-app meta tags. |
| `api/azure-tts.ts` | `POST` proxy to Azure TTS REST. Whitelists 6 voices (`ALLOWED_VOICES`); default `ru-RU-SvetlanaNeural`. Returns `audio/mpeg`. |
| `api/azure-pronounce.ts` | `POST` proxy to Azure Pronunciation Assessment. Takes `audio` blob (PCM wav, 16kHz mono) + `referenceText`, returns rich JSON (`PronunciationResult`). |
| `api/translate-phrase.ts` | OpenAI-first / Anthropic-fallback orchestrator for the "Try any phrase" feature. Returns `{ru, phonetic, notes?, provider}`. |
| `api/tutor/turn.ts` | Non-streaming voice-tutor turn. `multipart/form-data` with `audio` blob + `meta` JSON → audio/mpeg body + URL-encoded transcripts in `x-user-transcript` / `x-tutor-transcript` headers. Legacy, kept. |
| `api/tutor/turn-stream.ts` | **Primary** streaming voice-tutor turn. NDJSON response: `audio_chunk` events per sentence + `user_transcript` + `done`. Implements V1 (filler), V3 (parallel TTS), V4 (1-2 sent prompt), V9 (speculative Claude). |

## `src/components/` — React islands

| File | Purpose | Key exports |
|---|---|---|
| `App.tsx` | Top-level screen state machine. 8 screen variants in a discriminated union. | default `App` |
| `ScenarioPicker.tsx` | Home screen. Lists 9 scenarios as cards; per-card progress (introduced / total, lessons complete). Exposes "Talk to a tutor", "Try any phrase", and per-card "Quick Match" entry points. | default `ScenarioPicker` |
| `LessonPicker.tsx` | Inside a scenario. Lists lessons with state indicators (none / in-progress dot / complete check). "Up next" badge derived from `justCompletedLesson` prop. | default `LessonPicker` |
| `Lesson.tsx` | Drill player: circular hero (280px), phonetic card, score feedback, retry/next. Manages `phase` state machine: `idle → intro → ready → recording → grading → reveal`. End screen embedded. | default `Lesson` |
| `QuickMatch.tsx` | 4-card listening drill. Tap card plays Russian; correct flashes emerald, wrong flashes red and reveals correct. 10 rounds max. | default `QuickMatch` |
| `CustomPhraseEntry.tsx` | Form for "Try any phrase". Calls `translatePhrase()` and synthesizes a one-off `LexiconEntry` with `id: custom-<timestamp>`. SRS skipped for custom entries. | default `CustomPhraseEntry` |
| `TutorCallSetup.tsx` | Pre-call screen. Scenario picker + cost warning ("~$0.15/min, auto-end at 10 min"). The "Start call" `onClick` is the iOS-required user gesture for AudioContext + audio.play(). | default `TutorCallSetup` |
| `TutorCall.tsx` | In-call screen. Hidden `<audio playsInline>` sink, animated orb, last-4-line transcript, mute + end-call buttons. Wires `createFluidTutor()` to React state. | default `TutorCall` |
| `PhoneticCard.tsx` | Renders the phonetic syllable display with stress styling (UPPERCASE syllable → bold). Supports `wrongWordIndices` to highlight bad words red. Renders `variants` (gendered forms) as a quiet secondary line. | default `PhoneticCard` |
| `ScoreFeedback.tsx` | Verdict panel (Exact / Close / Miss + score%). Only place Cyrillic appears in the UI (the just-graded `targetDisplay`). | default `ScoreFeedback` |

## `src/lib/` — Pure logic + tests (provider-agnostic)

| File | Purpose | Key exports |
|---|---|---|
| `lexicon.ts` | Loads + types `src/data/lexicon.json`. Auto-merges `variants[*].ru` into `accepts` so grading passes any gendered form. | `lexicon`, `LexiconEntry`, `ScenarioId`, `phoneticSyllables` |
| `lessons.ts` | `ENTRIES_PER_LESSON = 7`; `lessonForSeq(seq)` derives lesson number. | `ENTRIES_PER_LESSON`, `lessonForSeq` |
| `scenarios.ts` | 9-scenario const array (`SCENARIOS`), each with `id, title, description, order, defaultRecommended`. Helper lookups. | `SCENARIOS`, `getScenario`, `entriesInScenario`, `Scenario` |
| `srs.ts` | Pimsleur SRS: `PIMSLEUR_INTERVALS_SECONDS`, `grade()`, `pickSessionQueue()`. Critical: `pickSessionQueue` scope-clamps due items via `Set(allIds).has()` (regression-tested in `srs.test.ts`). | `grade`, `newItem`, `pickSessionQueue`, `MASTERY_LEVEL`, `isMastered`, `outcomeFromScore` |
| `srs.test.ts` | 9 tests including the scope-clamp regression. |  |
| `session.ts` | `SessionManager` class — wraps localStorage progress, builds queues (`buildQueue`, `buildScenarioQueue`, `buildLessonQueue`), records attempts, computes `GlobalStats` (per-scenario + per-lesson + per-category). | `SessionManager`, `dayKey`, `nextStreak`, types |
| `session.test.ts` | Streak logic + queue-building tests. |  |
| `quickmatch.ts` | `pickQuickMatchSet(lexicon, target)` — picks 3 distractors with preference order: same scenario → same category → anything. | `pickQuickMatchSet` |
| `quickmatch.test.ts` | Distractor preference + uniqueness tests. |  |
| `grader.ts` | Two implementations: legacy `gradeTranscript` (Whisper + Levenshtein) and current `gradeFromAzure` (PA pronScore → SRS GradeResult, thresholds 90/75). Includes `normalize`, `levenshtein`, `diffWordIndices` (Needleman-Wunsch alignment), `isWordSubsequence`. | `gradeFromAzure`, `gradeTranscript`, `GradeResult` |
| `grader.test.ts` | 13 tests covering normalize, similarity, alignment, gradeTranscript including variant + word-subsequence acceptance. |  |
| `scenarios.test.ts` | Scenario lookup + filter tests. |  |
| `storage.ts` | localStorage shim. Single key `llh:v1:progress`. Returns empty Progress if SSR. | `loadProgress`, `saveProgress`, `resetProgress`, `Progress` |
| `recorder.ts` | Thin MediaRecorder wrapper. Picks the best supported mime (`audio/webm;codecs=opus` first). Returns `{stop, cancel}`. | `startRecording`, `Recorder` |
| `azure-speech.ts` | Server-side Azure REST client: `synthesizeSpeech`, `synthesizeFromSsml`, `assessPronunciation`. Parses both flat + nested PA score shapes. Used by API routes. | as listed |
| `elevenlabs-tts.ts` | Server-side ElevenLabs client. Voice = Sarah (`EXAVITQu4vr4xnSDxMaL`), model = `eleven_multilingual_v2`. Output mp3 22050/32. | `synthesizeWithElevenLabs`, voice/model constants |
| `tutor-conversation.ts` | Pure logic: `buildAzureTutorSystemPrompt(scenarioId, entries)` (Sveta's full persona), `buildSsml(text)` (per-language span SSML using single Ava voice), `splitByLanguage`, `stripMarkdownForTts`, `pickTutorPhrases`, `allTutorPhrases`. | as listed |
| `tutor-fillers.ts` | 5 pre-rendered Russian filler mp3s as base64 (`hmm`, `tak`, `aga`, `ponyatno`, `horosho`). Inlined into the worker bundle so V1's optimistic-filler emit doesn't take a same-domain subrequest hit (~1s on edge cold start). | `FILLER_AUDIO_B64`, `FILLER_SLUGS` |
| `translation/types.ts` | Shared `TranslationResult` + `SYSTEM_PROMPT` for OpenAI/Anthropic translation providers. | `TranslationResult`, `SYSTEM_PROMPT`, `ProviderError` |
| `translation/openai.ts` | OpenAI `gpt-4o-mini` translator (`response_format: json_object`). Throws `ProviderError`. | `translateWithOpenAI` |
| `translation/anthropic.ts` | Claude Haiku 4.5 translator. Strips ``` fences defensively. | `translateWithAnthropic` |

## `src/services/` — Provider abstractions (browser-side)

Pattern: each service exposes a single function (`speak`, `assessPronunciation`, `translatePhrase`) plus a `set<X>Provider()` swap function. Today there's one provider for each (Azure / Azure / API), but the indirection means swapping providers is one factory edit, no component changes.

| File | Purpose |
|---|---|
| `tts.ts` | TTS service entrypoint. `setTtsProvider('azure' \| 'webspeech')`. Today: Azure (with Web Speech automatic fallback in `azure-tts.ts`). |
| `pronunciation.ts` | Pronunciation service. `setPronunciationProvider('azure')`. Returns `PronunciationAssessment` with per-phoneme + per-word + overall scores. |
| `translation.ts` | Translation service with localStorage-backed cache (`translation-cache:v1`, max 200 entries). |
| `audio-convert.ts` | `blobToPcmWav(blob)` — webm/opus → 16kHz mono PCM via Web Audio API. Required for Azure PA. Also exports `float32ToWav` used by the fluid tutor session. |
| `azure-tutor.ts` | Push-to-talk (legacy v0) tutor session. `bootstrapGreeting`, `userTurn`, `startTurnRecording`. Targets `/api/tutor/turn`. |
| `azure-tutor-stream.ts` | **Primary** fluid VAD tutor session. `createFluidTutor({scenarioId, audioElement})`. Manages VAD lifecycle, barge-in (revokes in-flight `AbortController`, pauses audio element), serialized chunk playback, status transitions (`connecting → tutor_speaking → idle ↔ user_speaking → thinking`). Targets `/api/tutor/turn-stream`. |
| `providers/azure-tts.ts` | Azure TTS provider. 3-tier lookup: pregenerated lexicon manifest → in-memory cache → live `/api/azure-tts`. Falls back to Web Speech on total failure. |
| `providers/web-speech-tts.ts` | Browser Web Speech fallback. Picks best voice for `lang` from `speechSynthesis.getVoices()`. |
| `providers/azure-pronunciation.ts` | Azure PA provider. Converts blob → PCM wav, posts to `/api/azure-pronounce`. |
| `providers/api-translation.ts` | Server-orchestrator translation provider. `POST /api/translate-phrase`. |

## `src/data/`

| File | Purpose |
|---|---|
| `lexicon.json` | 327 entries. Each: `{id, en, ru, phonetic, category, tier, scenario, seq, lesson, notes?, accepts?, variants?}`. Distribution: compliment-flirt 86, romance-intimacy 63, practical-errands 31, numbers-time-money 30, approach-greet 26, reactions-filler 25, davai-versatile 24, mat-color 22, confrontation-dominance 20. |
| `audio-manifest.json` | `<lang>:<text>` → `/audio/<lang>/<id>.mp3` URL map. Generated by `scripts/pregenerate-lexicon-audio.mts`. Lookup table for the static-asset short-circuit in `azure-tts.ts`. |

## `src/styles/`

| File | Purpose |
|---|---|
| `global.css` | Tailwind directives + body gradient + iOS tap-highlight removal. Imported by `index.astro`. |

## `public/`

| Path | Purpose |
|---|---|
| `manifest.webmanifest` | PWA manifest. |
| `icons/icon-192.png`, `icon-512.png` | App icons. |
| `audio/{ru,en}/<id>.mp3` | Pregenerated lexicon audio (output of `audio:pregenerate`). |
| `vad/silero_vad_v5.onnx`, `vad.worklet.bundle.min.js`, `ort-wasm-simd-threaded.{wasm,mjs}`, `ort.wasm.min.mjs`, `ort.wasm.mjs` | Self-hosted Silero VAD + ONNX runtime. Copied from node_modules by `scripts/copy-vad-assets.mjs` at prebuild. |

## `scripts/`

| Script | Purpose |
|---|---|
| `copy-vad-assets.mjs` | Pre-build hook: copies Silero `.onnx` + ONNX runtime `.wasm/.mjs` from `node_modules` into `public/vad/`. Idempotent. |
| `pregenerate-lexicon-audio.mts` | Reads `lexicon.json`, calls Azure TTS for each `(en, ru)` pair (and `variants[*].ru`), writes `public/audio/{ru,en}/<id>.mp3`, regenerates `audio-manifest.json`. Skips files that already exist. Run after lexicon edits. |
| `azure-tts-bakeoff.ts` | Generates the same 10 phrases in 3 Azure voices for blind A/B listening. Output: `~/tts-test/<voice>/<seq>.mp3` + index.html. |
| `translation-bench.mts` | Bench OpenAI vs Anthropic translation quality + cost across a phrase set. |
| `azure-portal-auto.mjs`, `azure-portal-fetch-keys.mjs` | One-shot Playwright scripts for auto-provisioning the Azure Speech resource and pulling keys (saves portal click-through). |
| `qa-tutor-call.mjs` | End-to-end Playwright QA. Opens PROD with `--use-file-for-fake-audio-capture`, drives ScenarioPicker → Talk to a tutor → Start call, observes 30s of turn cycle, asserts: at least one 200, no 5xx, Sveta greeted with Cyrillic on screen, no console errors. Run: `QA_URL=https://langhelper.pages.dev node scripts/qa-tutor-call.mjs`. |
| `autoresearch/measure-tutor-latency.mjs` | Replays a fixed user turn N times against `/api/tutor/turn`, reports median + p90. |
| `autoresearch/measure-tutor-latency-stream.mjs` | Same but for `/api/tutor/turn-stream`. Reports `median_ttfa_ms`, `p90_ttfa_ms`, `median_total_ms`. |
| `autoresearch/verify-quality.mjs` | Quality gate. Runs ONE turn and exits 1 if Claude returned <20 chars. Use BEFORE the latency harness so you don't optimize a broken pipeline. |
| `autoresearch/render-fillers.mts` | Generates the 5 filler mp3s and emits the base64-inlined `tutor-fillers.ts`. |

## Key dependencies

| Package | Version | Purpose | Class |
|---|---|---|---|
| `astro` | `^4.16.0` | Static-+-server framework, islands architecture | runtime |
| `@astrojs/cloudflare` | `^11.0.0` | CF Pages Worker adapter (`output: 'server'`) | runtime |
| `@astrojs/react` | `^3.6.0` | React island integration | runtime |
| `@astrojs/tailwind` | `^5.1.0` | Tailwind integration | runtime |
| `react`, `react-dom` | `^18.3.0` | UI lib for islands | runtime |
| `tailwindcss` | `^3.4.0` | Utility CSS | runtime |
| `@ricky0123/vad-web` | `^0.0.30` | Silero VAD (browser, MicVAD class) | runtime |
| `onnxruntime-web` | `^1.25.1` | ONNX runtime for Silero | runtime |
| `vitest` | `^2.1.0` | Test runner | dev |
| `wrangler` | `^4.85.0` | CF Pages deploy + secrets CLI | dev |
| `playwright` | `^1.59.1` | QA harness driver | dev |
| `tsx` | `^4.21.0` | TS script runner (lexicon pregenerate, bakeoff) | dev |
| `typescript` | `^5.6.0` | Type checker | dev |

No `@anthropic-ai/sdk` or `openai` SDKs are installed — every LLM/Azure/ElevenLabs call is plain `fetch` against the REST endpoints. This keeps the CF Worker bundle tiny and avoids SDK polyfill churn.
