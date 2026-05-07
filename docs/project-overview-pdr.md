# Project Overview & Design Rationale

## What this is

A Russian language-learning PWA built for one user: **Ajay**, an English-speaking adult learner targeting conversational street Russian. It runs in iPhone Safari (added to home screen) with two distinct interaction modes:

1. **Drill mode** — Pimsleur-style scenario picker → lesson picker → circular-hero recorder. The user hears an English prompt, speaks Russian, gets phoneme-level pronunciation feedback (Azure), and is re-queued on a graduated-interval recall schedule.
2. **Voice tutor mode** — fluid (no-button) voice call with **Sveta**, an AI persona. Continuous mic + Silero VAD detect speech boundaries; she replies in mixed Russian + English with code-switching and barge-in support.

Live: **https://langhelper.pages.dev** (Cloudflare Pages, project `langhelper`).

Source: `src/pages/index.astro` mounts `App` (`src/components/App.tsx`) which is the screen-state machine: `picker → lessonpicker → lesson` for drill, `picker → tutorsetup → tutorcall` for tutor.

## Who it's for (and who it isn't)

**For:** an intermediate learner who already reads Cyrillic in their head but wants to *speak* without lifting it off a page. Specifically:

- Address woman by default (compliments, romance) — gendered adjective forms documented per-entry in `src/data/lexicon.json::variants`.
- Comfortable with mat (vulgar/slang) and informal `ты`-form — see scenarios `mat-color`, `confrontation-dominance`.
- Wants Pimsleur-style audio drill, not Duolingo gamification.

**Not for:**
- Beginners learning the Cyrillic alphabet. The UI shows phonetic-English romanization only (e.g. `pree-VYET` for привет). Cyrillic appears only in the `ScoreFeedback` panel for the just-graded attempt (`src/components/ScoreFeedback.tsx:49`).
- Reading or writing practice.
- Grammar drills.
- Multi-user / cloud sync. State lives in `localStorage` under key `llh:v1:progress` (`src/lib/storage.ts:3`).

## What it does — feature surface

### Drill flow
- **9 scenarios, 327 lexicon entries** (`src/data/lexicon.json`):
  - `approach-greet` (26), `compliment-flirt` (86 — largest), `romance-intimacy` (63), `practical-errands` (31), `confrontation-dominance` (20), `reactions-filler` (25), `numbers-time-money` (30), `mat-color` (22), `davai-versatile` (24).
- **Lesson grouping** — `ENTRIES_PER_LESSON = 7` (`src/lib/lessons.ts:1`); each scenario derives its lesson count from `ceil(seq / 7)`.
- **SRS** — Pimsleur intervals: 5s → 25s → 2min → 10min → 1h → 5h → 1d → 5d → 25d (`src/lib/srs.ts:1-11`). Mastery = level ≥ 5 (`MASTERY_LEVEL`).
- **Pronunciation grading** — Azure Pronunciation Assessment (per-phoneme + per-word + overall pronScore 0-100). `gradeFromAzure` (`src/lib/grader.ts:176`) maps to advance/hold/demote at thresholds 90/75.
- **Quick Match** — 4-card multiple-choice listening drill (English prompt → tap Russian phonetic). Unlocks at ≥4 introduced items per scenario (`src/components/QuickMatch.tsx`).
- **"Try any phrase"** — type any English string, OpenAI/Anthropic translates, you drill it as a one-off (`src/components/CustomPhraseEntry.tsx`).
- **Drive vs Study mode** — Study shows the phonetic card; Drive hides it until reveal. Toggle persists per session.
- **3-fail recovery hint** — after 3 failures on the same item, render a "Let's slow down" hint with a slow-playback button (`src/components/Lesson.tsx:475-493`).

### Voice tutor flow
- **Sveta persona** — patient native Russian speaker, ~70% Russian / ~30% English, ONE thing at a time, varies praise (молодец / точно / классно). Full system prompt in `src/lib/tutor-conversation.ts:80-140`.
- **Fluid VAD** — `@ricky0123/vad-web` (Silero v5) detects speech start/end. Barge-in cancels in-flight TTS + the streaming HTTP turn. Implementation: `src/services/azure-tutor-stream.ts:286-336`.
- **Streaming pipeline** — single NDJSON HTTP response delivers user transcript → mp3 chunks per sentence → done event. See [API Reference](api-reference.md) and [System Architecture](system-architecture.md).
- **Hard cap** — 10-minute auto-end (`HARD_TIMEOUT_MS` in `src/components/TutorCall.tsx:28`).

## Why this architecture

### Stack

- **Astro 4 + React 18** — Astro `.astro` shell ships zero JS by default; React islands handle interactivity. Only `App.tsx` is a `client:only="react"` mount (`src/pages/index.astro:21`). Result: tiny initial bundle, full reactivity where needed.
- **Cloudflare Pages + `@astrojs/cloudflare`** — `output: 'server'` (`astro.config.mjs:7`), one Worker handles every API route. Free tier covers everything; Worker cold-start is sub-100ms in eastern US. Chosen over Vercel/DO droplet for $0/month + Worker compute.
- **Anthropic Claude (Haiku 4.5)** — Sveta dialog. Streaming SSE via plain `fetch` (`src/pages/api/tutor/turn-stream.ts:240`). Model: `claude-haiku-4-5-20251001`, max_tokens 400, temperature 0.4 (V2 autoresearch tuning).
- **Azure Speech REST** — STT (bilingual ru-RU + en-US fallback), TTS (Ava Multilingual single-voice for code-switching), Pronunciation Assessment (per-phoneme scoring). Direct REST — no SDK; `src/lib/azure-speech.ts`.
- **ElevenLabs Sarah multilingual_v2** — Sveta's voice. Dramatically more natural Russian than Azure ru-RU-Svetlana. Starter tier ($6/mo) is required because the free tier blocks CF Worker datacenter IPs with `detected_unusual_activity` 401. Fallback chain: ElevenLabs → Azure SSML if quota/error (`src/pages/api/tutor/turn-stream.ts:160-163`).
- **`@ricky0123/vad-web` + `onnxruntime-web`** — Silero VAD running in a Web Worklet. Self-hosted under `/vad/` (copied from node_modules at build via `scripts/copy-vad-assets.mjs`).

### Locked decisions (don't relitigate)

| Decision | Why |
|---|---|
| **Phonetic-English UI only** | Ajay reads Cyrillic but it slows him down; the goal is *spoken* fluency. |
| **No accounts / no cloud sync** | Single user. localStorage is enough. |
| **`ru-RU-SvetlanaNeural` for pre-rendered lexicon mp3s** | Static `/audio/{ru,en}/<id>.mp3` shipped as edge-cached assets via `scripts/pregenerate-lexicon-audio.mts`. Zero Azure runtime cost for the corpus. Manifest at `src/data/audio-manifest.json`. |
| **Sveta uses ElevenLabs Sarah** | Voice continuity matters. Sarah handles Russian + English in one model. Same voice used for the inlined filler mp3s in `src/lib/tutor-fillers.ts`. |
| **Webm/opus → PCM wav client-side** | Azure PA only scores PCM. Web Audio API in `src/services/audio-convert.ts:8` decodes + downsamples to 16kHz mono. |
| **Anthropic prompt caching DISABLED** | Tried 2026-05-06. Haiku 4.5's 4096-token cache threshold can't be hit without bloating the prompt past the point where per-token overhead outweighs cache savings. Verified: padded to 2615 tokens, `cache_read=0`. Reverted (commits `b642699`, `90630f2`). |

### Non-goals

- Not a Duolingo clone: no streaks-as-gamification, no leaderboards, no XP.
- Not a beginner tool: assumes the user has a phonetic mental model.
- Not a Cyrillic literacy aid.
- Not a multi-language platform — Russian only.

## Where this is going (north-star vision)

Per memory file `~/.claude/projects/-Users-ajay/memory/project_language_learning_helper.md`:

The scenario picker should evolve from "lexicon group" into a **strategic scenario simulator** with visual support. Two layers:

1. **Strategic-scenario mode (long-form)** — a scripted role-play with an AI character. The user gets a setting and a goal and must initiate + sustain conversation in Russian. Concrete example:
   > "You are in Washington Square Park, NYC, on a spring sunny day. You happen to sit next to a beautiful Slavic woman. She is reading a book. What are you going to do to open up a conversation with her?"
2. **Visual support during regular lessons** — render an AI figure on screen the user is "talking to". Static then animated avatar; lipsync optional. The visual presence grounds the language in a person, not a phrase list.

When planning V3 work, design the scenario data model to support a `setting` (place, time, character profile, situation hook) alongside the phrase list. Don't ship without a real AI character — the visual is the point.

## Current state (May 2026)

- 27+ commits over multi-month iteration. Recent direction: voice-tutor latency optimization via autoresearch loops.
- **PROD median TTFA: 47ms** (V1 inline filler emit), **median total: 1132ms** for one full turn (V3 parallel TTS chain + V4 1-2 sentence prompt + V9 speculative Claude).
- Voice tutor pivots logged in commit history:
  - `7b4a9f9` — v0 OpenAI gpt-realtime + WebRTC (abandoned: quota exhausted).
  - `3eca2f7` — pivoted to Azure STT + Anthropic Claude + Azure TTS (push-to-talk).
  - `b8371d8` — fluid VAD + barge-in (no button).
  - `0362ab8`, `e5f08ce`, `ff87498`, `38b39ad`, `a163765` — multi-round latency optimization.
  - `158a0ea`, `02b4137` — ElevenLabs Sarah multilingual_v2 voice.
- **CF Pages auto-deploy webhook is broken** — pushes to `main` no longer trigger deploys. Use manual `wrangler pages deploy`. See [Deployment Guide](deployment-guide.md).

## Related docs

- [System Architecture](system-architecture.md) — component diagrams + data flow
- [Codebase Summary](codebase-summary.md) — file inventory
- [Code Standards](code-standards.md) — patterns, conventions, do-not-break rules
- [Configuration Guide](configuration-guide.md) — env vars and secrets
- [API Reference](api-reference.md) — every endpoint shape
- [Testing Guide](testing-guide.md) — vitest patterns + QA harness
- [Deployment Guide](deployment-guide.md) — manual wrangler deploy + secrets
- [Design Spec](design-spec.md) — colors, typography, components (custom doc, do not edit here)
- [UX Flow](ux-flow.md) — every screen's behavior (custom doc, do not edit here)
