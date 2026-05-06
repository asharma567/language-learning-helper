# Design Spec — Russian Learning App (Pimsleur-style)

## Color Palette

| Token | Tailwind class | Hex | Usage |
|---|---|---|---|
| Deep navy | `bg-navy-900` | `#0d1b2e` | Body gradient top, darkest surface |
| Mid navy | `bg-navy-800` | `#122240` | Gradient midpoint |
| Light navy | `bg-navy-700` | `#1a3055` | Elevated cards, scenario picker cards |
| Accent blue | `bg-accent` / `text-accent` | `#3b82f6` | Progress ring fill, speaker icons, CTA tint |
| Card white | `bg-card` | `#ffffff` | Quick Match answer cards, PhoneticCard surface |
| Card muted | `bg-card-muted` | `#f0f4f8` | Inactive/hover card state |
| Muted text | `text-text-mute` | `#94a3b8` | Secondary labels, subtext on dark |

Ring states (SVG stroke color via Tailwind `stroke-*` or inline style):

| State | Token | Hex | When |
|---|---|---|---|
| Not started | `stroke-arc-new` | `#334155` | No attempts on item yet |
| In progress | `stroke-arc-progress` | `#3b82f6` | Partially filled arc |
| Wrong (3-fail flash) | `stroke-arc-wrong` | `#ef4444` | Item failed 3× in session |

## Background

Body background: `bg-navy-gradient` — `linear-gradient(180deg, #0d1b2e 0%, #122240 50%, #1a3055 100%)`, fixed attachment, fills full viewport. Frontend note: remove any hard-coded `bg-black` from `<body>` in `index.astro` when adopting this gradient.

## Typography

Font stack: `font-sans` → `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (renders as SF Pro on iOS Safari). Phonetic display: `font-phonetic` (existing `ui-monospace` stack — do not rename).

| Scale | Class | Usage |
|---|---|---|
| Hero prompt | `text-3xl font-semibold` | English prompt centered inside circular hero |
| Card title | `text-xl font-semibold` | Scenario names, Quick Match answer text |
| Body | `text-base` | Descriptions, session stats |
| Muted label | `text-xs` | Progress fractions, category labels, header counters |

## Circular Hero

- Diameter: **280px** (fixed, does not scale). Tailwind: `w-[280px] h-[280px]`.
- SVG ring: `cx=140 cy=140 r=126`. Ring stroke width: **8px**. Ring is drawn as two concentric `<circle>` elements — track (full arc, `stroke-arc-new`, opacity 40%) and fill (partial arc, `stroke-arc-progress` or `stroke-arc-wrong`).
- Fill arc is a `stroke-dasharray` / `stroke-dashoffset` on the fill circle. Full circumference = `2π × 126 ≈ 792px`. Fill = `(index + 1) / queue.length × 792`.
- Ring color states: default fill uses `stroke-arc-progress`; when current item has 3+ failures in this session, fill flashes `stroke-arc-wrong` for 600ms then reverts.
- Content inside circle (absolutely centered): English prompt in `text-3xl font-semibold text-white text-center`, below it a play-Russian icon button (`w-10 h-10`, accent blue circle, speaker icon).
- Ring `stroke-linecap: round`. Ring starts at top (rotate SVG −90°).

## Card Style

- Quick Match answer cards: `bg-card rounded-2xl px-4 py-5 text-xl font-semibold text-gray-900 flex items-center gap-3 shadow-sm`. Speaker icon on left: `w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-accent`.
- PhoneticCard / score panel: `bg-navy-700 rounded-2xl border border-white/10 p-8`.
- Scenario picker cards: `bg-navy-700 rounded-2xl p-5 flex flex-col gap-2`.

## Button Shapes

- **Primary CTA** (Tap and speak, Start scenario): `rounded-full py-5 text-xl font-semibold bg-accent text-white` — full pill.
- **Quick Match answer cards**: `rounded-2xl` — see card style above.
- **Score feedback panel**: `rounded-xl border` — tighter corner for secondary info panels.
- **Exit / secondary**: `rounded-full border border-white/20 px-4 py-2 text-sm text-white/70`.
