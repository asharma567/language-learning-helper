# language-learning-helper

Personal Russian-learning PWA for one user (Ajay). Pimsleur-style scenario picker → lesson drill (with phoneme-level pronunciation grading via Azure) **plus** a fluid voice tutor "Sveta" with VAD-driven barge-in. UI is **phonetic-English only** — no Cyrillic in the main flow.

**Live**: https://langhelper.pages.dev (Cloudflare Pages, project `langhelper`).
**Stack**: Astro 4 + React 18 + TypeScript + Tailwind on Cloudflare Pages (`@astrojs/cloudflare`), Anthropic Claude Haiku 4.5, Azure Speech REST (TTS + STT + Pronunciation Assessment), ElevenLabs Sarah multilingual_v2 for Sveta's voice, Silero VAD via `@ricky0123/vad-web`.

---

## Documentation

| Doc | What it covers |
|---|---|
| [Project Overview & PDR](docs/project-overview-pdr.md) | Who it's for, what it does, locked decisions, north-star vision |
| [Codebase Summary](docs/codebase-summary.md) | File-by-file inventory + key dependencies |
| [System Architecture](docs/system-architecture.md) | Voice tutor pipeline, drill flow, build/deploy (Mermaid diagrams) |
| [Code Standards](docs/code-standards.md) | Conventions: islands, services, NDJSON wire, SSML, env access |
| [Configuration Guide](docs/configuration-guide.md) | Every env var (.env / .dev.vars / CF Pages secrets) |
| [API Reference](docs/api-reference.md) | Every endpoint shape + example invocation |
| [Testing Guide](docs/testing-guide.md) | vitest patterns, regression conventions, QA + latency harnesses |
| [Deployment Guide](docs/deployment-guide.md) | Manual `wrangler` deploy (auto-deploy webhook is broken) |
| [Design Spec](docs/design-spec.md) | Color palette, typography, hero/card sizes |
| [UX Flow](docs/ux-flow.md) | Every screen's behavior (returning user, drive mode, recovery hint, etc.) |

---

## How a session works

### Drill mode
1. ScenarioPicker → LessonPicker → Lesson player.
2. You hear the English prompt.
3. You speak Russian into the mic (`MediaRecorder` → webm/opus).
4. Browser converts to PCM wav (16kHz mono, Web Audio API) and POSTs to `/api/azure-pronounce`.
5. Azure returns per-phoneme + per-word + overall `pronScore` (0-100).
6. `gradeFromAzure` maps to advance / hold / demote (thresholds 90 / 75).
7. Pimsleur intervals: 5s → 25s → 2min → 10min → 1h → 5h → 1d → 5d → 25d.

### Voice tutor mode
1. ScenarioPicker → "Talk to a tutor" → TutorCallSetup → TutorCall.
2. Continuous mic + Silero VAD detects speech end (~700ms silence threshold).
3. POSTs WAV + history to `/api/tutor/turn-stream`.
4. Worker emits a Russian filler mp3 (`hmm`, `tak`, ...) immediately, runs STT + speculative Claude in parallel, then streams real Claude tokens, kicking off TTS per sentence in parallel and emitting mp3 chunks in strict order.
5. Browser plays each chunk as it arrives.
6. User starts speaking → barge-in (audio paused, in-flight HTTP aborted, mic picks up).
7. Hard cap: 10 min per call.

PROD median TTFA = **47ms** (V1 inline filler). PROD median total turn = **1132ms** (V3 parallel TTS + V4 1-2 sentence prompt + V9 speculative Claude).

---

## Setup

```sh
npm install
```

Create `.env` AND `.dev.vars` (both at repo root) with:

```
ANTHROPIC_API_KEY=sk-ant-...
AZURE_SPEECH_KEY=<32-char-hex>
AZURE_SPEECH_REGION=eastus
ELEVENLABS_API_KEY=sk_...
OPENAI_API_KEY=sk-...
```

See [Configuration Guide](docs/configuration-guide.md) for what each does and where to get them.

```sh
npm run dev      # http://localhost:4327
npm test         # vitest run
npm run build    # production build
```

Mic requires HTTPS in production — Cloudflare Pages handles this.

---

## Deploy

**The CF Pages git auto-deploy webhook is currently broken.** Pushes to `main` do NOT auto-deploy. Use:

```sh
npm run build
npx wrangler pages deploy dist --project-name=langhelper --branch=main --commit-dirty=true
```

Account ID: `fe61d9ff3b8906ec14a314af00550a8c`. Set/rotate secrets via `wrangler pages secret put <KEY> --project-name=langhelper`. Smoke-check the deploy with `QA_URL=https://langhelper.pages.dev node scripts/qa-tutor-call.mjs`.

Full procedure: [Deployment Guide](docs/deployment-guide.md).

---

## Extending the lexicon

Edit `src/data/lexicon.json`. Each entry:

```json
{
  "id": "unique-slug",
  "en": "English prompt",
  "ru": "Русский ответ",
  "phonetic": "ROO-skee aht-VYET",
  "category": "slang",
  "tier": 2,
  "scenario": "approach-greet",
  "seq": 4,
  "lesson": 1,
  "notes": "optional cultural / usage note",
  "variants": [
    { "ru": "...", "phonetic": "...", "label": "to a man" }
  ]
}
```

Phonetic conventions:
- Hyphens between syllables within a word.
- UPPERCASE on the stressed syllable.
- `'` after consonants that are palatalized (soft sign).
- `kh` = х, `zh` = ж, `sh` = ш, `ch` = ч, `ts` = ц, `y-` (yah/yoo/yet) for iotated vowels.

After editing, run `npm run audio:pregenerate` to bake new mp3s into `public/audio/` and regenerate `src/data/audio-manifest.json`. Idempotent — only newcomers cost Azure quota.

---

## Architecture notes

- Astro `output: 'server'` + `@astrojs/cloudflare` — single Worker handles every API route. Tiny initial bundle: only `App.tsx` is a `client:only="react"` mount.
- Service-layer abstractions (`src/services/{tts,pronunciation,translation}.ts`) — provider swap is one factory edit, not a component refactor.
- `src/lib/` is pure logic + tests. No `fetch` from browser context (server `azure-speech.ts` and `elevenlabs-tts.ts` are exceptions; they only run in API routes).
- VAD assets self-hosted under `/vad/` — copied from `node_modules` at prebuild via `scripts/copy-vad-assets.mjs`.
- State: localStorage (`llh:v1:progress`). No backend DB. No accounts.

---

## Out of scope (locked)

- Reading or writing Cyrillic.
- Grammar drills.
- Multi-user / cloud sync.
- Beginner-level alphabet teaching.

The vision for V3 — strategic-scenario simulator with avatar — is captured in [Project Overview](docs/project-overview-pdr.md#where-this-is-going-north-star-vision).

---

## Memory

The user's persistent project context lives at `~/.claude/projects/-Users-ajay/memory/project_language_learning_helper.md`. Read it before doing non-trivial work — it captures multi-month evolution, abandoned approaches, and locked technical decisions.
