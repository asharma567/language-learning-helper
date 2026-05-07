# Configuration Guide

Every env var the app reads, where it lives in dev vs PROD, and how to set it.

## Env vars

| Variable | Used by | Required for | Format |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `src/pages/api/tutor/turn.ts`, `turn-stream.ts`, `src/lib/translation/anthropic.ts` | Voice tutor (Sveta dialog), translation fallback | `sk-ant-…` |
| `AZURE_SPEECH_KEY` | `src/pages/api/azure-tts.ts`, `azure-pronounce.ts`, `tutor/turn*.ts`, `scripts/pregenerate-lexicon-audio.mts`, `scripts/azure-tts-bakeoff.ts` | TTS, STT, Pronunciation Assessment | 32-char hex |
| `AZURE_SPEECH_REGION` | same as above | Same | e.g. `eastus` |
| `ELEVENLABS_API_KEY` | `src/pages/api/tutor/turn-stream.ts` (`synthesizeWithElevenLabs`) | Sveta's natural Russian voice | `sk_…` |
| `OPENAI_API_KEY` | `src/pages/api/translate-phrase.ts` (primary translation), `src/lib/translation/openai.ts` | "Try any phrase" feature; legacy Whisper (no longer wired). Optional — Anthropic fallback covers if absent. | `sk-…` |

The app gracefully no-ops endpoints whose required keys are missing — `/api/tutor/turn-stream` returns 503 with `{error: 'Anthropic key not configured'}` if `ANTHROPIC_API_KEY` is unset, etc.

## Local development (.env + .dev.vars)

The Cloudflare adapter has `platformProxy: { enabled: true }` (`astro.config.mjs:8`), which surfaces `wrangler`-style env vars in dev. There are TWO files that need the same content:

### `.env` (root)
Used by Node-side scripts (`tsx scripts/...`, `vitest`).

```
ANTHROPIC_API_KEY=sk-ant-...
AZURE_SPEECH_KEY=<32-char-hex>
AZURE_SPEECH_REGION=eastus
ELEVENLABS_API_KEY=sk_...
OPENAI_API_KEY=sk-...
```

### `.dev.vars` (root)
Used by `wrangler`'s local dev runtime — i.e. when Astro dev server invokes the CF Pages worker for `/api/*` routes. Same keys, same values:

```
ANTHROPIC_API_KEY=sk-ant-...
AZURE_SPEECH_KEY=<32-char-hex>
AZURE_SPEECH_REGION=eastus
ELEVENLABS_API_KEY=sk_...
OPENAI_API_KEY=sk-...
```

Both are gitignored. `.env.example` (committed) is the template — copy and fill.

## Production (Cloudflare Pages secrets)

Set with `wrangler pages secret put`. Account ID = `fe61d9ff3b8906ec14a314af00550a8c`, project name = `langhelper`.

```sh
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name=langhelper
# (you'll be prompted to paste the value)
npx wrangler pages secret put AZURE_SPEECH_KEY --project-name=langhelper
npx wrangler pages secret put AZURE_SPEECH_REGION --project-name=langhelper
npx wrangler pages secret put ELEVENLABS_API_KEY --project-name=langhelper
npx wrangler pages secret put OPENAI_API_KEY --project-name=langhelper
```

List currently-set secrets:
```sh
npx wrangler pages secret list --project-name=langhelper
```

Delete a secret:
```sh
npx wrangler pages secret delete <KEY> --project-name=langhelper
```

The Worker reads them via `locals.runtime.env.<KEY>` — see the `getEnv(locals, ...)` helper in every API route.

## Cloudflare account

| Field | Value |
|---|---|
| Account ID | `fe61d9ff3b8906ec14a314af00550a8c` |
| Account email | ajay@datashop.ai |
| Project name | `langhelper` |
| Production branch | `main` (NOT `scaffold-v1`) |
| Live URL | https://langhelper.pages.dev |

`wrangler` reads the account ID from your local CF auth state (`npx wrangler login` once). If you have multiple accounts, pass `--account-id=fe61d9ff3b8906ec14a314af00550a8c` explicitly.

## ElevenLabs gotcha — paid tier required

ElevenLabs **free tier blocks all CF Worker IPs** with HTTP 401 `{"detail":{"status":"detected_unusual_activity"}}`. Their bot-protection treats datacenter IPs as suspicious. Symptoms in PROD: every Sveta sentence falls back to Azure SSML (still works, but voice continuity is lost).

Solution (already done): **Starter tier $6/mo** on the Chase Sapphire Reserve, renews June 6. The Starter tier whitelists API access from any IP. If the card expires or the subscription lapses, the fallback to Azure means the app continues working — but the voice degrades.

Local development with a residential IP works on the free tier.

If the user wants to verify the current tier, check https://elevenlabs.io/app/subscription.

## Voice / model identifiers (data, not env)

These live in code as constants — not env vars. Documented here so the inventory is in one place:

| Constant | File | Value |
|---|---|---|
| ElevenLabs voice | `src/lib/elevenlabs-tts.ts:10` | `EXAVITQu4vr4xnSDxMaL` (Sarah) |
| ElevenLabs model (quality) | `src/lib/elevenlabs-tts.ts:11` | `eleven_multilingual_v2` |
| ElevenLabs model (fast) | `src/lib/elevenlabs-tts.ts:12` | `eleven_flash_v2_5` (defined, not currently used) |
| Azure SSML voice | `src/lib/tutor-conversation.ts:191` | `en-US-AvaMultilingualNeural` (single voice for RU + EN) |
| Azure default RU TTS voice | `src/services/providers/azure-tts.ts:21-24` | `ru-RU-SvetlanaNeural` |
| Azure default EN TTS voice | same | `en-US-JennyNeural` |
| Anthropic model | `src/pages/api/tutor/turn.ts:207`, `turn-stream.ts:259`, `src/lib/translation/anthropic.ts:14` | `claude-haiku-4-5-20251001` |
| Anthropic temperature | `turn-stream.ts:261` | `0.4` (V2 autoresearch) |
| Anthropic max_tokens (tutor) | `turn-stream.ts:260` | `400` |
| OpenAI model (translation) | `src/lib/translation/openai.ts:23` | `gpt-4o-mini` |
| OpenAI temp / response_format | same | `0.2` / `{type: 'json_object'}` |

If you swap a voice or model, update this table.

## Where keys come from

- **Anthropic**: https://console.anthropic.com/settings/keys
- **Azure Speech**: portal.azure.com → Speech service resource → Keys and Endpoint. Region must match what's in `AZURE_SPEECH_REGION`. Auto-provision script: `scripts/azure-portal-auto.mjs` + `scripts/azure-portal-fetch-keys.mjs`.
- **ElevenLabs**: https://elevenlabs.io/app/settings/api-keys
- **OpenAI**: https://platform.openai.com/api-keys

## Cross-references

- How to actually deploy after setting these: [Deployment Guide](deployment-guide.md).
