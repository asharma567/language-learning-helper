# language-learning-helper

Personal Russian-learning PWA. Teaches spoken Russian via the Pimsleur method (graduated-interval recall) over a curated lexicon of fundamentals, slang, and mat. UI is **phonetic-English only** — no Cyrillic is shown to the learner.

## How a session works

1. You hear the English phrase.
2. You speak the Russian back into the mic.
3. Whisper transcribes you → the app compares to the target and scores strictly.
4. Wrong syllables are highlighted in red; exact matches advance the item's interval.
5. Items you get right keep coming back at Pimsleur intervals (5s → 25s → 2min → 10min → 1h → 5h → 1d → 5d → 25d).

Two modes:
- **Study** — phonetic card visible while you practice. Use when learning new items.
- **Drive** — audio-only, big button UI. Use on actual trips.

## Setup

```bash
npm install
```

Create `.dev.vars` in the project root with your OpenAI key:

```
OPENAI_API_KEY=sk-...
```

Whisper is ~$0.006/min. A 20-minute session is a few cents.

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

## Planned upgrades (v2)

Architected as drop-in swaps behind `src/lib/tts.ts` and `src/lib/grader.ts`:

- **ElevenLabs pregenerated audio** — trigger when iOS TTS proves too robotic. Add `audioUrl` to lexicon entries and check it before falling back to Web Speech.
- **Azure Pronunciation Assessment (phoneme-level)** — trigger when Whisper's transcript match is too forgiving. Swap `gradeTranscript`'s implementation; signature stays the same.

## Architecture notes

- Astro + React + Tailwind. Cloudflare Pages adapter, `output: 'server'`.
- One server endpoint: `/api/transcribe` proxies OpenAI Whisper so the key never touches the client.
- State: `localStorage` (`llh:v1:progress`). No accounts, no cloud sync.
- Pimsleur scheduler lives in `src/lib/srs.ts`. Strict grading: score=1 advances, ≥0.9 holds, <0.9 demotes.

## Out of scope (v1)

- Reading or writing Cyrillic.
- Grammar drills.
- Multi-user / cloud sync.
