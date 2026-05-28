# Architecture

```
src/                    # TypeScript frontend (Vite)
  main.ts               # All UI logic (~928 lines): DOM manipulation, state, Tauri invoke calls
  markdown.ts           # Markdown render + DOMPurify sanitization
  styles.css            # Dark-themed CSS (CSS Grid, modals, badge colors)
  index.html            # HTML shell with modal templates

src-tauri/src/          # Rust backend (Tauri)
  lib.rs                # App setup: DB init, register commands, midnight scheduler
  db.rs                 # SQLite pool initialization
  models.rs             # Enums: Context (personal/work), Category (daily/normal), Status (active/archived)
  tasks.rs              # Tauri commands: create/list/update/archive tasks
  spawned.rs            # Tauri commands: spawn task instances from templates
  daily.rs              # Tauri commands: daily instances CRUD, heatmap/calendar queries
  error.rs              # AppError → serialized String for frontend

src-tauri/migrations/
  0001_init.sql         # SQLite schema: tasks, daily_instances, spawned_tasks
```

## Data Model

Three SQLite tables:
- **tasks** — task definitions with context, category, is_template flag, due_date, note
- **daily_instances** — one row per (task_id, date) tracking completion + notes
- **spawned_tasks** — runtime instances spawned from template tasks

Rust enums (`Context`, `Category`, `Status`) serialize/deserialize as lowercase strings via serde.

## Key Patterns

**Midnight scheduler**: `lib.rs` spawns a background task that creates daily instances at local midnight and emits a `"daily-reset"` event to the frontend window.

**Debounced saves**: Daily note inputs use a 500ms debounce before calling the backend.

**Modals**: Create/Edit/Spawn modals are pre-rendered in HTML, shown/hidden via CSS classes. Backdrop click closes them.
