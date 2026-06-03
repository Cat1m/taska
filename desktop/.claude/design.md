# Taska — Design Reference

> Tóm tắt toàn bộ design system, layout và component của app Taska (Tauri 2.x desktop).  
> Dùng để onboard Claude hoặc designer mới — không cần đọc source code.

---

## 1. Visual Style

**Glassmorphism dark theme** — toàn bộ UI là các lớp glass semi-transparent đặt chồng lên một background tùy chỉnh (gradient hoặc ảnh). Không có nền trắng hay solid màu nào.

### Font

**JetBrains Mono** — monospace duy nhất cho toàn bộ UI, kể cả button và input. Không dùng sans-serif.

- Base size: `13px`, line-height `1.45`
- Weights dùng: 400 / 500 / 600 / 700

### Background

```
default: linear-gradient(135deg, #0c0d11 0%, #111820 50%, #141c2a 100%)
```

User có thể override bằng:
- Preset gradient (4 swatches lưới 4 cột)
- Solid color (color picker)
- Upload ảnh tùy chỉnh (lưu base64)

Background luôn `background-attachment: fixed` + `background-size: cover`.

---

## 2. Design Tokens (`src/styles.css` — `:root`)

### Glass layers

| Token | Value | Dùng cho |
|---|---|---|
| `--glass-heavy` | `rgba(12,15,20, 0.76)` | Sidebar, titlebar, modal card |
| `--glass-mid` | `rgba(18,22,30, 0.62)` | Panel nền, template card, col-head |
| `--glass-light` | `rgba(25,30,42, 0.44)` | Input, chip active, task row hover bg |
| `--glass-hover` | `rgba(32,38,52, 0.52)` | Hover state của row, button |

### Blur

| Token | Value | Dùng cho |
|---|---|---|
| `--blur-sm` | `blur(8px)` | Input, chip, dev-btn |
| `--blur-md` | `blur(14px)` | Titlebar, panel |
| `--blur-lg` | `blur(22px)` | Sidebar, modal, bg-panel |

### Border

| Token | Value |
|---|---|
| `--border` | `rgba(255,255,255, 0.07)` — subtle, row divider |
| `--border-2` | `rgba(255,255,255, 0.13)` — input, button, active |

### Text

| Token | Value | Dùng cho |
|---|---|---|
| `--fg-0` | `rgba(255,255,255, 0.96)` | Tiêu đề, nội dung chính |
| `--fg-1` | `rgba(220,225,232, 0.92)` | Body text, label |
| `--fg-2` | `rgba(172,180,192, 0.88)` | Secondary text, hint |
| `--fg-3` | `rgba(122,130,142, 0.72)` | Placeholder, disabled, metadata |

### Accent (adaptive)

Accent thay đổi tự động theo màu dominant của background (hàm `applyAdaptiveColors()` trong `main.ts`). Mặc định neutral trắng:

```css
--accent:      rgba(255,255,255, 0.88)
--accent-dim:  rgba(255,255,255, 0.18)
--accent-glow: 0 0 14px 2px rgba(255,255,255, 0.12)
```

### Semantic colors

| Token | Hex | Dùng cho |
|---|---|---|
| `--green` | `#6fae84` | Done state, streak, instructions label |
| `--green-d` | `rgba(36,59,49, 0.65)` | Heatmap h1 bg, nav-pill bg, reset banner |
| `--teal` | `#5a9ba0` | Context: personal |
| `--amber` | `#b3935a` | Context: work, "soon" due date |
| `--slate` | `#7d8694` | Category: normal |
| `--red` | `#b06a63` | Overdue, archived badge |

### Heatmap levels

| Token | Value |
|---|---|
| `--h0` | `rgba(255,255,255, 0.05)` |
| `--h1` | `rgba(36,59,49, 0.70)` |
| `--h2` | `rgba(46,85,64, 0.80)` |
| `--h3` | `rgba(74,124,94, 0.85)` |
| `--h4` | `#6fae84` + glow |

### Glow shadows

```css
--glow-green: 0 0 14px 2px rgba(111,174,132, 0.28)
--glow-teal:  0 0 12px 2px rgba(90,155,160, 0.22)
--glow-amber: 0 0 12px 2px rgba(179,147,90, 0.22)
```

### Border radius

```css
--radius:    6px   /* button, input, chip active */
--radius-lg: 10px  /* panel, modal card, template card */
```

---

## 3. Layout

```
┌─────────────────────────────────────────────────────┐
│  Titlebar (32px) — drag region + win dots           │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│   Sidebar    │            Content area              │
│   (216px)    │         (active view only)           │
│              │                                      │
│  nav-list    │   view-head                          │
│  (nav items) │   panel / daily-panel / stub-panel   │
│              │                                      │
│  [detail     │                                      │
│   mini list  │                                      │
│   when open] │                                      │
│              │                                      │
│  sidebar-    │                                      │
│  foot        │                                      │
└──────────────┴──────────────────────────────────────┘
         [reset-banner — fixed bottom when visible]
```

### Titlebar

- Height: `32px`
- Glass heavy + blur-md + border-bottom
- Left: brand text `"Taska · tauri 2.x"` (fg-2, 11px)
- Right: 3 dot buttons (macOS-style) — yellow minimize, green maximize, red close

### Sidebar

- Width: `216px`, fixed
- Glass heavy + blur-lg + border-right
- Top: brand mark (`T` trong box 24×24, accent border + glow) + `"Taska"` + version
- Middle: `nav-list` — các nav item
- Conditional: `sidebar-list-pane` (mini list khi detail view mở)
- Bottom: `"⬛ edit background"` button

**Nav item states:**
- Default: fg-1, no bg
- Hover: glass-light bg
- Active: glass-light bg + `inset 2px 0 0 var(--accent)` left border + accent-glow

**Nav pill** (badge count): pill xanh lá nhỏ `--green-d` bg / `--green` text, ẩn khi empty.

### Content area

Flex-1, transparent bg. Chứa 5 sections (`data-view`), chỉ section `.active` hiển thị (`display: flex`).

---

## 4. Views (Screens)

### My Day

```
view-head:
  h1"My Day"  [date nav ‹ today ›]  [↻ Reset]     [⑂ From template]  [+ New N]

panel:
  chip-bar: [all] [● personal] [● work]
  myday-meta: "X tasks · Y done"
  myday-list: instance-row × N
```

**Instance row** — grid 3 cột `26px 1fr auto`:
- Col 1: checkbox (16×16, border-radius 4px, checked = green fill + glow + checkmark)
- Col 2: title + badges + note textarea (debounce 500ms) + instructions block
- Col 3: delete button (ẩn, hiện khi hover row)

Done state: `opacity: 0.55` + title gạch ngang.

**Instructions block**: border-left 2px green, bg green 8%, label uppercase 9px green.

### Tasks

```
view-head:
  h1"Tasks"  [search input]  [active | archived]  [+ New N]

panel (tasks-panel):
  col-head: sticky header — [ ] Task | Tags | Due
  tasks-list: task-row × N
```

**Task row** — grid 4 cột `28px 1fr 152px 110px`:
- Col 1: context dot (7×7px circle, teal=personal / amber=work)
- Col 2: title + instructions preview (green 11px) + note preview (ellipsis)
- Col 3: badges (context + category)
- Col 4: due date (fg-2 normal / amber "soon" / red "over")

Click row → mở Detail view.

### Templates

```
view-head: h1"Templates" + "reusable task blueprints"

panel:
  templates-list: template-card × N
```

**Template card**: glass-mid bg + blur-sm, border-radius-lg. Hover: lift shadow `0 4px 24px rgba(0,0,0,0.35)`. Có expand/collapse cho note dài, 2 action button (Edit / Use → spawn).

### Daily

```
view-head: h1"Daily" + "completion heatmap"

panel (daily-panel):
  stat-tiles (3 tiles): today done | today rate (green) | best streak
  heat-wrap: heatmap (GitHub-style 7-row grid)
  heat-legend: less → [h0–h4] → more
```

**Heatmap**: 13×13px cells, border-radius 2.5px, gap 3px. Today cell có outline 1.5px fg-1. Level 4 có green glow.

### Detail view

Mở khi click task row. Sidebar chuyển sang mini-list mode (danh sách tasks thu nhỏ bên trái, highlight item đang xem).

```
view-head: [‹ back]  (title placeholder)  [Edit btn primary]

panel:
  detail-view-body (padding 28px 36px):
    detail-view-header:
      title (22px 600)
      badges row

    section "Hướng dẫn" (ẩn nếu không có)
    section "Note" (ẩn nếu không có)
    hoặc empty state italic
```

---

## 5. Components

### Button variants

| Class | Style |
|---|---|
| `.btn` (default) | glass-light bg + border-2 + blur-sm |
| `.btn.primary` | accent-dim bg + accent color + accent-glow |
| `.btn.ghost` | transparent bg + no border + fg-2 |

Primary hover: accent solid bg, dark text, stronger glow.

### Badge

Inline pill `3px border-radius`, 10px 500 font.

| Class | Color |
|---|---|
| `.ctx-personal` | teal (bg teal 18% + glow-teal) |
| `.ctx-work` | amber (bg amber 18% + glow-amber) |
| `.cat-daily` | green (bg green 18%) |
| `.cat-normal` | slate (bg slate 18%) |
| `.b-template` | amber (bg amber 12%) |
| `.b-archived` | red (bg red 18%) |

### Chip bar (filter tabs)

Pill shape (`border-radius: 999px`), transparent default, glass-light + border-2 + accent-glow khi active.

### Choice group (segmented control)

Inline-flex với overflow hidden, glass-light bg, từng button ngăn cách bằng border-right. Active: accent-dim bg + accent color.

### Switch (toggle)

32×18px, pill shape. Off: border-2 gray. On: accent-dim bg, thumb slides 14px, thumb color = accent.

### Modal

- Scrim: `rgba(0,0,0,0.55)` + `blur(4px)`
- Card: glass-heavy + blur-lg + border-2 (top border sáng hơn: `rgba(255,255,255,0.22)`)
- Width: `clamp(480px, 55vw, 820px)`, max-height 90vh
- Animation: `translateY(-10px) scale(0.97)` → normal, 0.18s ease
- Header: title + mode-tag pill (uppercase 9px) + close ×
- Footer: Cancel ghost + Save primary
- Mode tag: `CREATE` / `EDIT` / `SPAWN` (accent color trên accent-dim bg)

**Modal fields**: tất cả input/textarea/select dùng glass-light bg + border-2. Focus: accent border + accent-glow.

### Background picker panel

Fixed popup `bottom: 50px, left: 8px`, width 280px, glass-heavy + blur-lg. Chứa:
- 4-column swatch grid (aspect-ratio 1.6, label overlay)
- Solid color picker
- Upload image button

### Heatmap

GitHub contribution graph style. 7 hàng (Mon–Sun), cột = tuần. Cells 13×13px. Month labels ở trên, day labels ở trái.

---

## 6. Interaction Patterns

| Pattern | Detail |
|---|---|
| **Hover reveal** | Delete button trong instance-row ẩn, hiện khi hover row |
| **Debounced save** | Note textarea trong My Day debounce 500ms, hiện "saving…" / "saved" |
| **Expand/collapse** | Instructions block và template note có toggle show more/less |
| **Adaptive accent** | Khi đổi background, JS extract màu dominant → override `--accent` CSS var |
| **Keyboard shortcut** | `N` → mở new task modal (hiển thị `<kbd>N</kbd>` trên button) |
| **Modal modes** | Một modal duy nhất dùng `data-mode="create|edit|spawn"` để ẩn/hiện field |
| **Date navigation** | My Day có ‹ / › để xem ngày hôm qua. Nút › ẩn khi đang ở ngày hôm nay |
| **Daily reset banner** | Fixed bottom banner (green, pulse animation) khi midnight scheduler chạy |
| **Detail mini-list** | Sidebar thêm pane danh sách thu nhỏ khi vào detail view, active item highlight accent left border |

---

## 7. Scrollbars & overflow

- Tất cả scroll container: `overflow-y: auto`, không custom scrollbar (native)
- Body và html: `overflow: hidden` (app không scroll, từng panel scroll riêng)

---

## 8. Accessibility / UX notes

- `user-select: none` trên titlebar và nav items (không select được text)
- `data-tauri-drag-region` trên titlebar để drag cửa sổ
- Placeholder text dùng `--fg-3`
- Done task: opacity 0.55 + line-through (không xóa khỏi list)
- Archived task trong Tasks view: opacity 0.5 + line-through
