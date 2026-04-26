# UX Flow — Russian Learning App (Pimsleur-style)

## Screens

1. **ScenarioPicker** — home / landing
2. **Lesson** — inside-scenario study player
3. **EndScreen** — post-session summary
4. **QuickMatch** — listening practice mode

---

## 1. First-time Onboarding (no localStorage data)

Detection: `SessionManager.getStats().introduced === 0` on mount.

Behavior: render ScenarioPicker as normal — no special splash or modal. The "Approach & Greet" scenario card is visually highlighted with an `accent`-colored ring and a "Start here" label badge (`text-xs bg-accent text-white rounded-full px-2 py-0.5`). All other scenarios are visible and tappable (not locked). No tutorial overlay. The highlighted card communicates the recommended starting point without blocking the user.

---

## 2. Returning-User Landing

Detection: any `introduced > 0` in localStorage.

Behavior: render ScenarioPicker. No highlight on any card — user picks freely. Each card shows per-scenario progress (`X / N introduced`). If a scenario has due items, show a small amber dot indicator (`w-2 h-2 rounded-full bg-amber-400`) to the right of the progress fraction.

---

## 3. Scenario Picker — Information Architecture

**Card order:** fixed, matches the 8 canonical scenario IDs in `SCENARIOS` array order:
1. Approach & Greet
2. Compliment & Flirt
3. Romance & Intimacy
4. Practical Errands
5. Confrontation & Dominance
6. Reactions & Filler
7. Numbers, Time, Money
8. Mat & Color

**Per-card content:**
- Scenario title (`text-xl font-semibold text-white`)
- One-line description (`text-sm text-text-mute`)
- Progress line: `X introduced · Y mastered` (`text-xs text-text-mute`)
- Progress bar: `h-1 rounded-full bg-white/10` track, `bg-accent` fill at `introduced/total × 100%`
- Quick Match chip: if `introduced >= 4`, show a small `Quick Match` pill button (`text-xs rounded-full border border-accent/40 text-accent px-2 py-0.5`) on the card. Tapping it navigates directly to QuickMatch for that scenario (bypasses Lesson).
- First-time highlight: "Start here" badge on Approach & Greet only when `introduced === 0` globally.

**Top strip (compact):** global streak (`🔥 N`) and global mastered count on one line, `text-xs text-text-mute`, right-aligned. Not interactive.

**Tap a card → Lesson.** The scenario ID is passed as a prop/context so `buildScenarioQueue(scenarioId)` is called instead of `buildQueue()`.

---

## 4. Inside-Scenario Flow (Lesson)

**Top header (full width, 44px tall):**
- Left: "Exit" (`text-sm text-white/70`, taps → back to ScenarioPicker, no confirmation)
- Center: scenario title (`text-sm font-semibold text-white`, truncated at 20 chars with ellipsis)
- Right: `index+1 / queue.length` (`text-xs text-text-mute font-mono`)

**Circular hero (280px diameter, centered):**
- SVG progress ring (spec in design-spec.md)
- English prompt centered inside (`text-3xl font-semibold text-white`)
- Play-Russian button below prompt inside circle: `w-10 h-10 rounded-full bg-accent flex items-center justify-center` with speaker SVG icon. Tapping it calls `speak(entry.ru, { lang: 'ru-RU' })`.

**Phonetic card (below circle):**
- Visible when: `mode === 'study'` OR `phase === 'reveal'` OR `current.isNew`.
- Hidden when: `mode === 'drive'` AND `phase !== 'reveal'` AND `!current.isNew`.

**Drive vs Study mode:**
- Toggle lives in top-right of the session area, below the header: small pill toggle `Study | Drive` (`text-xs rounded-full`). Default: Study.
- Study mode: phonetic card always visible. Drive mode: phonetic card hidden until reveal. Recommendation copy (shown once on first Drive activation, then never again, stored in localStorage key `driveModeSeen`): "Drive mode hides the text — rely on your ears."
- Mode persists for the duration of the session. Resets to Study on new session.

**Phase flow:**
- `idle` → auto-advances to `intro` (for new items) or `ready` (for recall items) immediately on mount.
- `intro`: speaks EN then RU twice. Phonetic card visible. No button shown, just `text-sm text-text-mute "Introducing…"`.
- `ready`: shows "Tap and speak" pill (`bg-accent rounded-full`). Play-Russian button active.
- `recording`: shows "Stop" pill (`bg-red-500 rounded-full`). Play-Russian button disabled.
- `grading`: shows disabled "Grading…" pill (`bg-navy-700 rounded-full opacity-50`).
- `reveal`: shows Retry + Next buttons side by side. Phonetic card always visible. Score feedback panel below circle.

---

## 5. End-of-Session Screen

Trigger: `index >= queue.length && queue.length > 0`.

**Layout:**
- Title: "Session complete" (`text-3xl font-semibold text-white text-center`)
- Subtitle: `N min · M attempts` (`text-sm text-text-mute text-center`)
- Stats card (`bg-navy-700 rounded-2xl p-6`): New / Advanced / Accuracy in 3-column grid.
- Overall card: Introduced / Mastered / Streak.
- **Quick Match entry point:** if `scenarioIntroduced >= 4`, show a prominent accent-outlined button `"Play Quick Match"` (`rounded-full border-2 border-accent text-accent py-4 text-xl font-semibold w-full`). If fewer than 4 introduced in this scenario, button is absent (not disabled, not shown).
- Bottom: `"Start another session"` pill (`bg-accent rounded-full`). Tapping calls `buildScenarioQueue(scenarioId)` with the same scenario — does NOT return to ScenarioPicker.
- `"Change scenario"` text link below the pill (`text-sm text-text-mute underline`). Tapping navigates to ScenarioPicker.

---

## 6. Quick Match — Entry, Flow, Exit

**Entry points:**
- Quick Match chip on ScenarioPicker card (scenario has ≥4 introduced items).
- "Play Quick Match" button on EndScreen (same condition).

**Header:** same top-header pattern — "Exit" left, "Quick Match" center, `round/10` right.

**Per round:**
- Center: English prompt (`text-xl font-semibold text-white text-center`, above cards).
- 4 answer cards stacked vertically (`bg-card rounded-2xl`), each with speaker icon + Russian text.
- Tapping a card plays its Russian audio immediately via `speak(entry.ru, { lang: 'ru-RU' })`.
- **Correct tap:** card flashes green (`bg-emerald-500`) for 400ms, then auto-advances to next round after 600ms total. SRS: if `item.isDue` (i.e. the item was in the due queue at session start), call `recordAttempt(target.id, 1)` — full advance, same as a correct mic attempt. If `!item.isDue` (surplus practice), make no `recordAttempt` call — don't reset the schedule for items the user practiced ahead of time.
- **Wrong tap:** tapped card flashes red (`bg-red-400`) for 400ms. Correct card highlights green. After 800ms, auto-advances. SRS: `recordAttempt(target.id, 0)` (demote, same as a missed mic attempt).
- Progress ring is not shown in Quick Match (no circular hero). Just the header progress fraction.

**Session length:** exactly 10 rounds drawn from `pickQuickMatchSet` for each round target. Targets are shuffled introduced items from the scenario; if fewer than 10 introduced, rounds = introduced count (minimum 4 to enter).

**End of Quick Match:** auto-navigate to EndScreen for the scenario (same EndScreen, same stats). No separate Quick Match summary screen.

**Exit (tapping "Exit" in header):** immediately navigate to ScenarioPicker. No confirmation.

---

## 7. Three-Fail Recovery Hint

Trigger: same `entry.id` has been graded `score < 0.9` three or more times within the current session (tracked in component state, not persisted).

Behavior: on the `reveal` phase after the third failure, render an additional hint panel below the score feedback panel:

- Container: `bg-navy-700 rounded-xl border border-white/10 p-4`
- Icon: a small pause/breath icon or just `text-lg` `"🐢"`.
- Heading: `"Let's slow down"` (`text-sm font-semibold text-white`)
- Body: `"Repeat after the audio. No pressure to record."` (`text-xs text-text-mute`)
- Action: a `"Hear it again"` button (`text-xs rounded-full border border-white/20 px-3 py-1.5 text-white/70`) that calls `speak(entry.ru, { lang: 'ru-RU' })` when tapped.

The hint panel only appears on the 3rd+ failure reveal. It disappears automatically when the user taps Retry or Next (normal flow continues — item is re-queued by SRS logic as usual).

---

## 8. Lesson Escalation — LessonPicker & Multi-Lesson Scenarios

### 8a. Screen order

**ScenarioPicker → LessonPicker → Lesson player.**

Tapping a scenario card never auto-starts a lesson. It always navigates to the LessonPicker for that scenario. The user must see where they are before committing to a session, especially on returning visits. Auto-start-next-due creates invisible jumps ("why did it skip to Lesson 3?") that erode trust.

### 8b. Lesson completion model

All lessons are unlocked from the start. No locks, no padlocks, no greyed-out cards. These are real-life scenarios, not a curriculum — a user who already knows the Approach & Greet basics should jump to Lesson 3 without grinding through 1 and 2. SRS handles reinforcement; the LessonPicker handles navigation.

### 8c. ScenarioPicker — per-scenario progress display

Each scenario card shows two monotonic metrics (both only ever increase):

- `"X / N introduced"` — total entries in the scenario the user has been shown at least once
- `"X / N lessons complete"` — count of lessons where every entry is at mastery level (SRS interval ≥ 5). Shows `0` if no lesson is fully mastered yet.

Example card footer: `"9 / 16 introduced · 1 / 4 lessons complete"` (`text-xs text-text-mute`).

The ScenarioPicker stays at this high-altitude summary. Per-lesson granularity lives in the LessonPicker only.

Update to section 3 per-card content: replace the existing `"X introduced · Y mastered"` progress line with the two-metric line above. The progress bar fill stays `introduced/total × 100%` as before.

### 8d. LessonPicker screen

**Header:** same top-header pattern — "Back" left (taps → ScenarioPicker), scenario title center, nothing right.

**Card list:** one card per lesson, fixed numerical order (Lesson 1 first). Each card (`bg-navy-700 rounded-2xl p-4 flex items-center justify-between`):

- **Left column:**
  - Title: `"Lesson N"` or `"Lesson N: Short Label"` if `lesson.title` is provided. (`text-base font-semibold text-white`)
  - Progress: `"X / Y introduced"` for entries in this lesson only. If all Y entries are mastered, replace with `"Complete"` in `text-emerald-400`. (`text-xs text-text-mute`)
- **Right side (state indicator, vertically centered):**
  - Not started (`introduced === 0`): no indicator.
  - In progress (`introduced > 0 && !complete`): `w-2 h-2 rounded-full bg-accent`.
  - Complete (all entries mastered): checkmark icon, `text-emerald-400`, 16px.
- All cards are tappable regardless of state — no disabled or locked cards.

**"Up next" highlight:** after returning from a completed lesson, the next-in-sequence card shows an accent left border (`border-l-2 border-accent`) and an `"Up next"` badge (`text-xs bg-accent/20 text-accent rounded-full px-2 py-0.5`). This is derived from navigation state (a `justCompletedLessonIndex` prop), not persisted — it only appears immediately after returning from a session.

**Tapping a lesson card:** navigates to the Lesson player, scoped to that lesson's entries via `buildLessonQueue(scenarioId, lessonIndex)`.

### 8e. End-of-lesson vs end-of-scenario

**End-of-lesson** (this lesson's queue exhausted; other lessons in scenario remain):
- Navigate back to the LessonPicker. The "Up next" highlight appears on the following lesson card.
- No interstitial summary screen — the LessonPicker is the natural pause point.

**End-of-scenario** (all lessons in the scenario have every entry at mastery level):
- Navigate to the existing EndScreen.
- Title: `"Scenario complete"` instead of `"Session complete"`.
- Stats card and Quick Match entry point unchanged.
- Primary CTA: `"Back to scenarios"` pill (`bg-accent rounded-full py-5 text-xl font-semibold text-white w-full`) replacing `"Start another session"`.
- Remove `"Change scenario"` text link (the primary CTA already goes to ScenarioPicker).

**Normal session end** (lesson queue exhausted, scenario not fully mastered — most common):
- Navigate to existing EndScreen per section 5. `"Start another session"` calls `buildLessonQueue(scenarioId, lessonIndex)` for the same lesson (not the old `buildScenarioQueue`). `"Change scenario"` navigates to ScenarioPicker.

### 8f. Returning-user landing

Unchanged from section 2: land on ScenarioPicker. The two-metric display gives enough orientation — the user taps their scenario, sees the LessonPicker, and picks where to continue. No auto-routing into a specific lesson.

### 8g. Lesson naming

Default display: `"Lesson N"`. If `lesson.title` (optional string field) is present and non-empty, display `"Lesson N: [title]"`. Frontend renders whichever form is provided; no fallback logic beyond checking for presence. Titles are 2–4 words by convention (e.g., `"First Contact"`, `"Compliments"`). Backend provides titles only where a lesson has a clear, obvious theme — unprovided is fine.
