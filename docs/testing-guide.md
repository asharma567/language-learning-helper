# Testing Guide

How tests are organized, how to run them, and what each one covers.

## Running tests

```sh
npm test            # vitest run (one shot, exits)
npm run test:watch  # vitest in watch mode
```

Vitest auto-discovers `*.test.ts` files anywhere under the project. There's no separate test directory — every test sits next to the source it covers.

```
src/lib/
├── grader.ts        # source
├── grader.test.ts   # tests
├── srs.ts
├── srs.test.ts
├── scenarios.ts
├── scenarios.test.ts
├── session.ts
├── session.test.ts
├── quickmatch.ts
└── quickmatch.test.ts
```

There are 5 test files, all in `src/lib/`. `src/services/` and `src/components/` are untested at the unit level today — they're exercised by the QA harness instead.

## Conventions

### Stubbing localStorage / window
Anything that reaches into `loadProgress` / `saveProgress` (`SessionManager`) needs a fake store. The pattern (`src/lib/session.test.ts:13-32`):

```ts
let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  });
  vi.stubGlobal('window', {});
});
afterEach(() => { vi.unstubAllGlobals(); });
```

If a test imports anything that touches localStorage WITHOUT this setup, it pollutes the dev environment. Catch this in code review.

### Deterministic randomness
For tests on shuffled output (`pickQuickMatchSet`, `pickTutorPhrases`), inject a deterministic random function:

```ts
const deterministicRand = (seq: number[]) => {
  let i = 0;
  return () => seq[i++ % seq.length];
};
const result = pickQuickMatchSet(lex, target, { random: deterministicRand([0, 0.5]) });
```

See `src/lib/quickmatch.test.ts:23`.

### Regression tests are named explicitly
Every regression test should call out the bug it locks in. The model (`src/lib/srs.test.ts:99`):

```ts
it('clamps due-item selection to the supplied scope (regression: scenario isolation)', () => {
  // 'a' and 'b' are both globally due; only 'b' is in scope.
  // ...
  // 'a' must NOT leak in even though it's due — it's outside scope.
  expect(result).toEqual(['b', 'c']);
});
```

This makes the test self-documenting for the next person who tries to "simplify" `pickSessionQueue` and breaks scenario isolation.

## Coverage by file

### `src/lib/srs.test.ts` (9 tests, 109 LOC)
- `outcomeFromScore`: thresholds 1.0 → advance, [0.9, 1.0) → hold, <0.9 → demote.
- `grade`:
  - advances correct attempts, increments level + sets dueAt = now + interval
  - clamps at MAX_LEVEL
  - hold preserves level, requeues at previous interval
  - demote drops level, requeues in 30s
  - floors at level 0
- `pickSessionQueue`:
  - returns due before new
  - treats un-introduced as new
  - respects newPerSession cap
  - skips not-yet-due
  - **REGRESSION: scope-clamps due selection** — without this, every scenario load was dominated by globally-due items.

### `src/lib/grader.test.ts` (13 tests, 115 LOC)
- `normalize`: lowercase, ё→е, punctuation strip, dash/quote handling.
- `levenshtein`: identity (0), single edits.
- `similarity`: exact-after-normalize is 1, partial is in (0.5, 1).
- `diffWordIndices`: identical → empty; substituted-word index returned; missing word in heard → that target index returned.
- `isWordSubsequence`: identical match; padded match (`'что'` in `'так что'`); strict ordering required; missing word rejected.
- `gradeTranscript`:
  - exact match → score 1, exact=true, no wrong indices
  - mismatch → wrongWordIndices populated
  - confidence passed through
  - padded single-word transcripts accepted
  - variant transcripts accepted (`'что'` matched against accepts `['чё', 'шо']`)
  - variant embedded in longer transcript
  - reorder still fails
  - missing word still fails

### `src/lib/scenarios.test.ts` (193 LOC)
- `getScenario`, `entriesInScenario`, `getScenarioForEntry` lookups.
- `SessionManager` queue building per-scenario uses correct entries (no leakage).

### `src/lib/session.test.ts` (229 LOC)
- `nextStreak`: starts at 1 from null, no-op on same day, increments on consecutive day, resets on gap.
- `dayKey`: stable yyyy-mm-dd.
- `SessionManager`:
  - persists via stubbed localStorage
  - `recordAttempt` increments stats + streak
  - `getStats` computes per-scenario + per-lesson breakdowns
  - `buildLessonQueue` filters to lesson-scoped entries
  - lesson derivation via `lessonForSeq` (defined `ENTRIES_PER_LESSON = 7`).

### `src/lib/quickmatch.test.ts` (156 LOC)
- Target unchanged in returned set.
- 3 distractors returned.
- Distractor preference order: same scenario → same category → fallback.
- Distractor uniqueness (no duplicates by id).
- Throws when lexicon < 4 entries.

## End-to-end QA harness

`scripts/qa-tutor-call.mjs` drives PROD with a real Chromium + fake mic. The QA mantra (from the user's memory): **drive the real user flow end-to-end — endpoint 200s ≠ QA**.

Run:
```sh
QA_URL=https://langhelper.pages.dev node scripts/qa-tutor-call.mjs
# defaults to PROD URL
# exits 0 if all checks pass, 1 otherwise
```

What it does:
1. Launches Chromium with `--use-file-for-fake-audio-capture=/tmp/fake-mic-tih-krasivaya.wav` (a pre-recorded "ты красивая" wav).
2. Waits for the persistent profile mic permission to take effect.
3. Clicks `Talk to a tutor` → `Start call`.
4. Observes 30s of turn cycle, capturing every `/api/tutor/turn*` response (status, ms, body for streaming).
5. Asserts:
   - At least one `/api/tutor/turn(-stream)` returned 200.
   - No 5xx (502/503 = pipeline broken).
   - **Sveta's greeting rendered to screen** — Cyrillic or "Sveta"/"Привет" present in the rendered DOM. This is the truth source, not the response body.
   - No console errors.

Artifacts saved to `/tmp/qa-tutor-artifacts/final-state.png`.

The harness only checks pipeline aliveness — it cannot judge voice quality. Per the user's `feedback_qa_before_release.md`: human ears still required.

## Latency harnesses

Two scripts under `scripts/autoresearch/`. Both target the dev server at `localhost:4327` by default; override with `HARNESS_URL`.

### `measure-tutor-latency-stream.mjs`
Replays a fixed user turn N times (`HARNESS_TRIALS=N`, default 3) against `/api/tutor/turn-stream`, reports:
- `median_ttfa_ms` — time-to-first-audio-chunk (the perceived latency)
- `p90_ttfa_ms`
- `median_total_ms` — full turn duration

```sh
HARNESS_URL=http://localhost:4327/api/tutor/turn-stream HARNESS_TRIALS=10 \
  node scripts/autoresearch/measure-tutor-latency-stream.mjs
# {"median_ttfa_ms":47,"p90_ttfa_ms":89,"median_total_ms":1132,"n":10,"of":10}
```

### `measure-tutor-latency.mjs`
Same shape, non-streaming endpoint (`/api/tutor/turn`). Reports `ttfb` instead of `ttfa`. Used to compare streaming vs non-streaming.

### `verify-quality.mjs` — quality gate
Run BEFORE the latency harness. Fails (exit 1) if Claude returned <20 chars. The latency metric is meaningless if the pipeline is broken (e.g. a model swap that returns empty content makes only the V1 filler count as audio).

```sh
node scripts/autoresearch/verify-quality.mjs
# Quality OK (147 chars): Привет! I'm Sveta. Want to practice...
```

The autoresearch loop on tutor latency runs `verify-quality.mjs && measure-tutor-latency-stream.mjs` together — quality first, speed second.

## What's NOT tested

- React components — no RTL setup. Component coverage relies on the QA harness driving real DOM.
- Service-layer code (`src/services/`) — no jsdom setup for Web Audio / MediaRecorder / Audio element.
- API routes — covered indirectly by the QA harness and latency probes. Adding vitest unit tests would require mocking `fetch` to Azure / Anthropic / ElevenLabs, which historically caught nothing the harness didn't.
- Lexicon data correctness — tier/scenario/seq/lesson assignments are not validated. There's no schema check.

If you add coverage in any of these areas, document the pattern here.

## Cross-references

- Endpoints exercised by the harnesses: [API Reference](api-reference.md).
- The latency-pipeline diagrams that motivate these harnesses: [System Architecture](system-architecture.md).
