# Deployment Guide

## TL;DR

```sh
npm run build
npx wrangler pages deploy dist --project-name=langhelper --branch=main --commit-dirty=true
```

That's the deploy. Everything below is context.

---

## ⚠️ Auto-deploy is broken — use manual wrangler

The Cloudflare Pages git integration **does not currently auto-deploy on push to `main`**. The webhook is stuck (discovered 2026-05-06). Until it's fixed, every code change requires the manual `wrangler pages deploy` invocation above.

If you skip this and assume your push went out, you'll be QA-ing yesterday's bits. The user has explicitly flagged this as the kind of mistake that erodes trust ("real wins not theater"). Always finish a deploy with the smoke check below.

---

## Project facts

| Field | Value |
|---|---|
| Live URL | https://langhelper.pages.dev |
| CF account | ajay@datashop.ai |
| CF account ID | `fe61d9ff3b8906ec14a314af00550a8c` |
| CF Pages project | `langhelper` |
| Production branch | `main` |
| Build output dir | `dist/` |
| Deploy tool | `wrangler` 4.x (devDep) |

`scaffold-v1` is a stale branch — nothing in PROD is wired to it. Don't deploy from it.

---

## Step-by-step deploy

### 1. Confirm a clean working tree (or accept dirty)

```sh
git status
```

Wrangler accepts `--commit-dirty=true` to ship uncommitted changes. Use this only when you're hot-fixing PROD and will commit immediately after; otherwise commit first so the deploy maps to a known SHA.

### 2. Build

```sh
npm run build
```

This runs `astro build`. Prebuild (`scripts/copy-vad-assets.mjs`) executes automatically — copies Silero `.onnx` + ONNX runtime `.wasm/.mjs` from `node_modules` into `public/vad/`.

Output: `dist/_worker.js/`, `dist/_routes.json`, plus all static assets (audio, vad, icons). The Worker bundle includes the base64-inlined filler mp3s (~12KB × 5).

### 3. Deploy

```sh
npx wrangler pages deploy dist --project-name=langhelper --branch=main --commit-dirty=true
```

Wrangler will:
- Upload `dist/` to CF Pages.
- Bind the deployment to the `main` branch (production alias).
- Print a deployment URL like `https://abc123.langhelper.pages.dev` AND the production alias `https://langhelper.pages.dev`.

If you target a different branch (e.g. `--branch=preview`), you get a preview URL only — the production alias does NOT update.

### 4. Smoke check

Hit the live URL and walk the real flow. Per the user's QA mantra:

```sh
QA_URL=https://langhelper.pages.dev node scripts/qa-tutor-call.mjs
```

This runs the Playwright harness with a fake mic, drives ScenarioPicker → Talk to a tutor → Start call, and asserts:
- At least one `/api/tutor/turn(-stream)` returned 200
- No 5xx
- Sveta greeted on screen (Cyrillic / "Sveta" / "Привет" rendered)
- No console errors

Exit 0 = ship it. Exit 1 = roll back.

### 5. (Optional) verify production secrets are still there

```sh
npx wrangler pages secret list --project-name=langhelper
```

Should show: `ANTHROPIC_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`. See [Configuration Guide](configuration-guide.md) for the meaning of each.

---

## Setting / rotating secrets

```sh
npx wrangler pages secret put ELEVENLABS_API_KEY --project-name=langhelper
# (paste value at the prompt)
```

Setting a secret takes effect on the next request — no redeploy needed. Verify with:

```sh
npx wrangler pages secret list --project-name=langhelper
```

To remove a secret:

```sh
npx wrangler pages secret delete <KEY> --project-name=langhelper
```

---

## Rolling back

CF Pages keeps every deployment. Roll back in the dashboard at https://dash.cloudflare.com/{accountId}/pages/view/langhelper/deployments — find a previous deployment, click "Manage" → "Rollback to this deployment". The production alias flips immediately.

There's no `wrangler` rollback subcommand — use the dashboard.

---

## Re-enabling git auto-deploy (when fixed)

If/when you reconnect the GitHub integration:
1. Dashboard → Pages project `langhelper` → Settings → Builds & deployments.
2. Connect to `asharma567/language-learning-helper`, production branch = `main`.
3. Build command: `npm run build`. Build output dir: `dist`.
4. Add the same env vars / secrets there (or rely on the existing project secrets — they persist).
5. Push a no-op commit. If the deploy fires, you're good.
6. Then DELETE this section from the doc and update the warning at the top.

---

## Lexicon-audio pregeneration (rare)

After editing `src/data/lexicon.json`:

```sh
npm run audio:pregenerate
```

This runs `scripts/pregenerate-lexicon-audio.mts`:
- Reads `src/data/lexicon.json`
- For each `(en, ru)` pair (and each `variants[*].ru`), calls Azure TTS via `synthesizeSpeech`
- Writes `public/audio/{ru,en}/<id>.mp3`
- Regenerates `src/data/audio-manifest.json`
- **Skips files that already exist** — only newcomers cost Azure quota.

Then commit the new mp3s + manifest, build, and deploy. The audio shows up at `/audio/...` on PROD.

Don't pregenerate ad-hoc — the static audio is the cheap path. Without manifest entries, every TTS call hits the live Azure endpoint per session, which is fine but wasteful.

---

## Cross-references

- Env vars + secrets in detail: [Configuration Guide](configuration-guide.md).
- Smoke-test harness internals: [Testing Guide](testing-guide.md).
