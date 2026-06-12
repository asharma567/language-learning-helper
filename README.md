# language-learning-helper

Personal Russian-learning PWA. Teaches spoken Russian via the Pimsleur method (graduated-interval recall) over a curated lexicon of fundamentals, slang, and mat. UI is **phonetic-English only** — no Cyrillic is shown to the learner.

## How a session works

1. You hear the English phrase.
2. You speak the Russian back into the mic.
3. Azure Speech transcribes/assesses you (OpenAI `gpt-4o-mini-transcribe` is the automatic fallback) → the app compares to the target and scores strictly.
4. Wrong syllables are highlighted in red; exact matches advance the item's interval.
5. Items you get right keep coming back at Pimsleur intervals (5s → 25s → 2min → 10min → 1h → 5h → 1d → 5d → 25d).

Modes:
- **Study** — phonetic card visible while you practice. Use when learning new items.
- **Drive** — audio-only, big button UI. Use on actual trips.
- **Tutor call (Sveta)** — fluid voice conversation (VAD, barge-in) with a Claude Haiku tutor persona, streamed sentence-by-sentence over `/api/tutor/turn-stream`.

## Setup

```bash
npm install
```

Create `.dev.vars` in the project root with the provider keys:

```
AZURE_SPEECH_KEY=...        # primary STT + pronunciation assessment (+ TTS fallback)
AZURE_SPEECH_REGION=...
ANTHROPIC_API_KEY=sk-ant-...# Claude Haiku — Sveta tutor dialogue
ELEVENLABS_API_KEY=...      # primary tutor TTS (Sarah voice, multilingual_v2 / flash_v2_5)
OPENAI_API_KEY=sk-...       # resilience fallback: gpt-4o-mini-transcribe STT + gpt-4o-mini-tts
```

Azure/OpenAI STT is fractions of a cent per minute. The binding cost is ElevenLabs
TTS credits (Starter: 30K/month) — mitigated by pre-rendered filler/praise audio,
an in-memory repeat cache, and flash_v2_5 for pure-English sentences.

## Run locally

```bash
npm run dev      # http://localhost:4321
npm run test     # vitest
npm run build    # production build
```

Grant Safari mic permission on first use. Mic requires HTTPS in production — Cloudflare Pages handles this.

## Deploy (Cloudflare Pages)

1. Push to GitHub (already done).
2. In the Cloudflare dashboard, create a Pages project connected to this repo.
3. Build command: `npm run build`. Output directory: `dist`.
4. Add the env var `OPENAI_API_KEY` as a secret.
5. Install the deployed URL to your iPhone home screen ("Add to Home Screen" from Safari share sheet).

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
  "notes": "optional cultural / usage note"
}
```

Phonetic conventions:
- Hyphens between syllables within a word.
- UPPERCASE on the stressed syllable.
- `'` after consonants that are palatalized (soft sign).
- `kh` = х, `zh` = ж, `sh` = ш, `ch` = ч, `ts` = ц, `y-` (yah/yoo/yet) for iotated vowels.

## Architecture notes

- Astro + React + Tailwind. Cloudflare Pages adapter, `output: 'server'`.
- Server endpoints (keys never touch the client):
  - `/api/azure-pronounce` — Azure Pronunciation Assessment (phoneme-level); falls back to OpenAI transcription + string-match grading if Azure is down.
  - `/api/azure-tts` — Azure neural TTS for lexicon audio; OpenAI `gpt-4o-mini-tts` fallback.
  - `/api/tutor/turn-stream` — Sveta tutor turn: STT (Azure → OpenAI fallback) → Claude Haiku streamed → per-sentence TTS (ElevenLabs Sarah → Azure → OpenAI fallback chain), NDJSON to the client.
  - `/api/translate-phrase` — phrase translation helper.
- Tutor cost controls: history capped to the last 12 turns (client + server), pre-rendered base64 filler/praise clips (`src/lib/tutor-fillers.ts`, `src/lib/tutor-praise.ts`), in-memory TTS repeat cache, `eleven_flash_v2_5` for pure-English sentences, speculative Claude calls capped at 150 output tokens with logged hit/miss.
- State: `localStorage` (`llh:v1:progress`). No accounts, no cloud sync.
- Pimsleur scheduler lives in `src/lib/srs.ts`. Strict grading: score=1 advances, ≥0.9 holds, <0.9 demotes.

## Out of scope (v1)

- Reading or writing Cyrillic.
- Grammar drills.
- Multi-user / cloud sync.
