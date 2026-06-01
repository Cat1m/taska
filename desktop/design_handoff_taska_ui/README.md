# Handoff: Taska Desktop UI (My Day / Tasks / Spawned / Daily)

## Overview
Taska is a **Tauri 2.x desktop app** for task tracking with a focus on recurring "daily"
habits. This bundle is the UI design for the full app shell and its four primary views,
plus the create/edit/spawn modal and a midnight `daily-reset` indicator.

Aesthetic: **industrial dark dev-tool** (not a consumer app). Monospace type, dense
information layout, muted accents. A **light theme** variant is included and is meant to
plug into the app's existing dark/light theme system.

## About the Design Files
The files in this bundle (`Taska.html`, `taska.css`, `taska.js`) are **design references
authored in plain HTML/CSS/JS** — a working prototype that demonstrates the intended look,
layout, and interactions. **They are not production code to copy verbatim.**

The task is to **recreate these designs inside the Taska codebase's existing environment**
(Tauri 2.x front-end — whatever framework is already in use: vanilla, React, Svelte, Vue,
SolidJS, etc.) using its established components, state layer, and Tauri command/IPC bindings.
Wire the UI to the **real Rust backend** (commands returning the records described under
*Data Model*), not to the hard-coded seed arrays in `taska.js`. If the front-end framework
is not yet chosen, pick the one best suited to the project and implement there.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, density, and interaction
behavior are all intentional. Recreate pixel-faithfully using the codebase's own styling
approach (CSS modules / Tailwind / styled-components / etc.), pulling the exact token values
from the *Design Tokens* section below.

---

## Data Model (authoritative — matches the Rust backend)

Rust enums serialize **lowercase**.

- **tasks**: `title` (string), `context` (`"personal"` | `"work"`),
  `category` (`"daily"` | `"normal"`), `status` (`"active"` | `"archived"`),
  `is_template` (bool), `due_date` (ISO `YYYY-MM-DD` | null), `note` (string).
- **daily_instances**: one row per `(task_id, date)`. Tracks `done` (bool) + `note` (string)
  for that specific day. Drives the completion heatmap. (`streak` in the prototype is a
  derived/display value — compute it backend-side or from instance history.)
- **spawned_tasks**: instances spawned from a template task (`is_template = true`). Each has
  a `parent_id` (the template's task id), `title`, `spawned_at` date, and a status.

> **IMPORTANT — context model changed.** Earlier iterations split the whole app by a global
> `personal` / `work` context switcher. **That switcher has been removed.** `context` is now
> purely a per-task field surfaced as a **badge**. Every list shows both contexts together;
> only the **My Day** view offers an optional client-side filter (all / personal / work).

---

## Screens / Views

The app shell is a 2-row grid: a **custom titlebar** (32px) over a **body** that is a
2-column grid — **sidebar** (216px) + **content** (fluid).

### App shell — Titlebar
- 32px tall, `--bg-1`, 1px bottom border `--line`.
- Left: `Taska · tauri 2.x` (11px, `--fg-2`; "Taska" is `--fg-1`, weight 600).
- Right: **theme toggle** button (`◐ light` / `◑ dark`) then three 11px round window dots
  (amber=min, green=max, red=close). Mark the bar `-webkit-app-region: drag` and the
  controls `no-drag` (Tauri custom titlebar). In a real Tauri app, wire the dots to the
  window's `minimize()` / `toggleMaximize()` / `close()`.

### App shell — Sidebar
- `--bg-1`, 1px right border.
- **Brand** (top): 24px square outline mark (green border, letter "T") + "Taska" (15px,
  weight 600, 1px letter-spacing) + version `v0.4.1` (10px, `--fg-3`, right-aligned).
- **Nav** (`Views` label, 10px uppercase `--fg-3`): four items, each = icon + label +
  count pill (right-aligned, `--bg-4`, 11px). Active item: `--bg-3` bg, `--line-2` border,
  icon turns green.
  - `◉ My Day` — count = number of today's daily instances **not yet done**.
  - `☰ Tasks` — count = number of `active` tasks.
  - `⑂ Spawned` — count = total spawned instances.
  - `▦ Daily` — count = total daily instances tracked today.
- **Bottom**: a dev affordance button `↻ Simulate daily-reset` (12px, `--fg-2`). In
  production this is **not a button** — it's triggered by the real `daily-reset` event
  (see *Interactions*). Keep or drop per product needs.

### View 1 — My Day  (default landing view)
- **Purpose**: the focused "what do I do today" screen, unifying daily instances from both
  contexts.
- **Header**: `My Day` (h1, 18px/600) + long date subtitle (`Mon, Jun 1 2026`, 12px
  `--fg-2`) + spacer + `notes autosave · 500ms debounce` hint (10px `--fg-3`) +
  **New** primary button (green, with `N` kbd hint).
- **Body**: one `.panel` (`--bg-1`, 1px `--line`, 7px radius).
  - Panel head: `Today` (13px/600) + **filter chips** (`all` / `personal` / `work`,
    pill-shaped, 11.5px; active = `--bg-4` + `--line-2`; personal/work chips carry a 7px
    teal/amber dot) + right-aligned meta `X/Y done`.
  - Panel body: list of **instance rows**. Each row = grid `18px 1fr`:
    - 16px checkbox (`.chk`): square, 4px radius, 1.5px `--line-2` border. Done state:
      `--green-d` fill, `--green` border, green `✓`.
    - Main: title row = task title (13.5px; struck through + `--fg-2` when done) +
      **context badge** + right-aligned `▲ {n}d streak` (10.5px green).
    - Note field: full-width `<textarea>` (`--bg-2`, 1px `--line`, min-height 34px) with a
      tiny status label bottom-right that reads `saving…` (amber) → `✓ saved` (green) on
      a **500ms debounce**.

### View 2 — Tasks
- **Purpose**: full task list across both contexts.
- **Header**: `Tasks` + spacer + **search** box (filters title + note, live) +
  **segmented filter** `active` / `archived` + **New** button.
- **Column header** (sticky): `[ ] · Task · Tags · Due` — grid `24px 1fr 150px 110px`.
- **Task rows** (same grid): checkbox (clicking toggles `status` active↔archived) ·
  main (title + optional `template` tag in amber + 1-line note preview prefixed `›`) ·
  badges (context + category) · due cell. Archived rows render at 0.5 opacity.
  Clicking a row (not the checkbox) opens the **edit modal**.
- **Due cell** logic: `—` if none; else relative — `{n}d overdue` (red `.over`), `today` /
  `tomorrow` / `in {n}d`. `--amber` (`.soon`) when due within 2 days, red when overdue.

### View 3 — Spawned
- **Purpose**: instances spawned from template tasks, grouped by their parent template.
- **Header**: `Spawned` + `Spawn from template…` ghost button.
- For each template (`is_template = true`): a **group** with a head row (`⑂` branch glyph,
  template title, context badge, `{n} spawned` count pill) followed by child **spawn rows**
  (grid `16px 16px 1fr 130px 90px`): tree connector (`├` / `└`), checkbox, instance title,
  `spawned {date}`, and a **status pill** — `scheduled` (amber, = pending), `active`
  (neutral), `done` (green).

### View 4 — Daily
- **Purpose**: completion analytics. **No editable list here** — interaction lives in My Day.
- **Header**: `Daily` + `Completion heatmap + today's instances` subtitle.
- One `.panel` containing:
  - **Stats row**: three tiles — `today done` (e.g. `2/5`), `today rate` (e.g. `40%`,
    green), `best streak` (e.g. `31d`). Values 22px/600; labels 10px uppercase `--fg-3`.
  - **Heatmap**: GitHub-style grid, **18 weeks** back, 7 rows (Sun→Sat) × week columns.
    Each cell 13px, 2.5px radius, level 0–4 mapped to the green scale (`--h0`…`--h4`).
    Today's cell carries an outline ring and reflects the **live** completion ratio of
    today's instances. Day labels (Mon/Wed/Fri) on the left; month labels along the top.
    `title` tooltip per cell: `{iso} · {lvl}/4 daily done`. Legend `less ▢▢▢▢▢ more`.
  - Today completion → heatmap level mapping: 0 done = lvl 0; ≤25% = 1; ≤50% = 2; <100% = 3;
    100% = 4.

### Modal — Create / Edit / Spawn (pre-rendered, show/hide via `.open`)
- Centered card (480px), `--bg-1`, 1px `--line-2`, 9px radius, drop shadow; dimmed +
  slightly blurred scrim. Animates in (translateY + scale). Closes on scrim click, the `×`,
  Cancel, or `Esc`.
- **Head**: title (`Create task` / `Edit task` / `Spawn instance`) + uppercase mode tag
  (green) + `×`.
- **Fields**: Title (text) · row[ Context choice (personal/work) | Category choice
  (daily/normal) ] · row[ Due date (date) | Status choice (active/archived) ] · Note
  (textarea) · **Is template** toggle switch (`— spawns instances into the Spawned view`) ·
  conditional **Spawn for date** field (only in spawn mode).
- **Foot**: Cancel ghost (`esc` kbd) + primary save button whose label = `Create` /
  `Save changes` / `Spawn` by mode.
- The "choice" controls are segmented two-button pickers; the active one gets `--bg-3` +
  `--line-2` and its colored dot. Wire these to set the corresponding task fields on save.

---

## Interactions & Behavior
- **View switching**: sidebar nav items toggle the `.active` class on both the nav item and
  the matching `.view` section. Keyboard: `1` My Day · `2` Tasks · `3` Spawned · `4` Daily
  (ignored while typing in an input/textarea).
- **My Day chips**: client-side filter of today's instances by `context` (`all` keeps both).
- **Toggle done** (My Day checkbox): flips `daily_instances.done` for that `(task_id, today)`
  → persist via backend command → update the row, the `X/Y done` meta, the My Day nav count,
  and (when Daily is viewed) the live today heatmap cell + stats.
- **Note autosave**: typing in an instance note shows `saving…`, and **500ms after the last
  keystroke** commits the note (backend write) and shows `✓ saved` (clears after ~1.4s).
  Implement as a per-instance debounce.
- **Task checkbox** (Tasks view): toggles `status` between `active` and `archived`.
- **Row click** (Tasks): opens edit modal populated from that task.
- **New / edit / spawn**: open modal in the right mode; on save, create/update the task (or
  spawn an instance) via backend command and re-render.
- **`daily-reset` event** (midnight rollover): the backend emits a Tauri event named
  `daily-reset`. On receipt, today's daily instances roll over to a new day (`done` cleared,
  streaks preserved) and a **subtle banner** slides down from the top of the content area
  (34px, green pulse dot, message, dismiss `×`, auto-hides after ~6s). The prototype's
  "Simulate daily-reset" button stands in for this event during design.
- **Theme toggle**: flips `data-theme` on `<html>` between (unset)=dark and `light`,
  persisted (prototype uses `localStorage`; in-app, hook into the existing theme store).
  NOTE: when toggling live, force a full style recompute so already-painted nodes pick up
  the new custom-property values (prototype briefly toggles `documentElement.style.display`).
  In a component framework this is usually unnecessary — re-render handles it.

## State Management
- **Current view** (`myday` | `tasks` | `spawned` | `daily`), default `myday`.
- **My Day context filter** (`all` | `personal` | `work`), default `all`.
- **Tasks filter** (`active` | `archived`) + **search string**.
- **Theme** (`dark` | `light`), persisted.
- **Data**: `tasks[]`, `daily_instances[]` (today + history for the heatmap),
  `spawned_tasks[]` — all fetched from backend commands. Today's date drives `due` math and
  the heatmap's "today" cell.
- **Modal**: open/closed + mode (`create`/`edit`/`spawn`) + the task being edited.

## Design Tokens

### Colors — Dark (default)
| Token | Hex | Use |
|---|---|---|
| `--bg-0` | `#0c0d0f` | window void / deepest |
| `--bg-1` | `#131518` | sidebar, panels, modal |
| `--bg-2` | `#181b1f` | main content bg, inputs |
| `--bg-3` | `#1e2228` | cards / rows |
| `--bg-4` | `#262b32` | hover / raised |
| `--line` | `#2a2f37` | hairline borders |
| `--line-2` | `#353c45` | stronger borders |
| `--fg-0` | `#e2e5ea` | primary text |
| `--fg-1` | `#aab0ba` | secondary text |
| `--fg-2` | `#6f7681` | muted text |
| `--fg-3` | `#4a505a` | faint / disabled |
| `--green` | `#6fae84` | daily completion accent |
| `--green-d` | `#3f6b50` | dim green (button/fill bg) |
| `--teal` | `#5a9ba0` | context: personal |
| `--amber` | `#b3935a` | context: work |
| `--slate` | `#7d8694` | category: normal |
| `--red` | `#b06a63` | destructive / overdue |
| heatmap | `--h0 #1a1e23` `--h1 #243d30` `--h2 #2f5d42` `--h3 #437f5b` `--h4 #6fae84` | completion levels 0–4 |

### Colors — Light (`<html data-theme="light">` overrides)
| Token | Hex |
|---|---|
| `--bg-0` | `#d7d6d0` |
| `--bg-1` | `#e8e7e1` |
| `--bg-2` | `#f1f0ec` |
| `--bg-3` | `#fbfaf7` |
| `--bg-4` | `#eceae3` |
| `--line` | `#d9d7ce` |
| `--line-2` | `#c5c2b7` |
| `--fg-0` | `#21242a` |
| `--fg-1` | `#4c515a` |
| `--fg-2` | `#7c828c` |
| `--fg-3` | `#a9aeb4` |
| `--green` | `#3f7d59` |
| `--green-d` | `#cfe4d6` |
| `--teal` | `#2f7e83` |
| `--amber` | `#8a6a30` |
| `--slate` | `#59616c` |
| `--red` | `#a8504a` |
| heatmap | `--h0 #e6e5df` `--h1 #c5ddcc` `--h2 #95c5a6` `--h3 #5fa078` `--h4 #3f7d59` |

Light theme also adjusts: primary button = solid `--green` bg with `#f3f8f4` text; badge
text colors are darkened (personal `#246a6e`, work `#7a5d28`, daily `#336649`); checkmark
stays dark-green on the light `--green-d` fill. See `taska.css` for the full
`:root[data-theme="light"]` block.

### Typography
- Font: **JetBrains Mono** (Google Fonts), fallback `ui-monospace, "SF Mono", Menlo,
  monospace`. Weights used: 400 / 500 / 600 / 700.
- Base 13px / line-height 1.45. h1 18px·600. Panel h2 13px·600. Labels 10–11px uppercase,
  ~1px letter-spacing. Stat values 22px·600. Smallest text 9–10px (heatmap labels, hints).

### Spacing / Radius / Shadow
- Grid: titlebar 32px · sidebar 216px. View padding 16–24px. Row padding ~12px 14px.
- Radii: `--radius: 5px` (controls), 7px (panels), 9px (modal), 3px (chips inner / tags),
  full pill (chips, count pills, status pills).
- Heatmap cell 13px, gap 3px, radius 2.5px.
- Modal shadow `0 24px 60px rgba(0,0,0,.5)` (dark) / `0 20px 50px rgba(40,40,30,.22)` (light).
- Reset banner: 34px tall, green pulse animation (1.6s).

## Assets
- **No raster/SVG assets.** All iconography is Unicode glyphs (`◉ ☰ ⑂ ▦ ↻ ⑂ ├ └ ◐ ◑ ✓ ▲ ⌕ ∅`)
  rendered in the monospace font. Swap for the codebase's existing icon set if preferred;
  keep them visually minimal/monochrome to preserve the dev-tool feel.
- Brand mark is a CSS-drawn square with the letter "T" — no logo file.

## Files
- `Taska.html` — app shell markup: titlebar, sidebar, all four view sections, the modal.
  Look for `data-view="..."` sections and `data-screen-label` attributes.
- `taska.css` — full token system (`:root` dark + `:root[data-theme="light"]`), all
  component styles.
- `taska.js` — render functions per view, seed data (replace with backend calls),
  interaction wiring, heatmap builder, debounce logic, theme toggle. The seed arrays
  (`tasks`, `dailyInstances`, `spawnedTasks`) document the exact shapes the UI expects.
