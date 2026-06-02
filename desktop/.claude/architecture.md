# Architecture

```
src/                    # TypeScript frontend (Vite)
  main.ts               # All UI logic (~928 lines): DOM manipulation, state, Tauri invoke calls
  markdown.ts           # Markdown render + DOMPurify sanitization
  styles.css            # Dark-themed CSS (CSS Grid, modals, badge colors)
  index.html            # HTML shell with modal templates

src-tauri/src/          # Rust backend (Tauri)
  lib.rs                # App setup: DB init, register commands, midnight scheduler
  db.rs                 # SQLite pool initialization (AppState { pool })
  models.rs             # Shared enums: Context, Category, Status + domain structs Task, DailyInstance, SpawnedTask
  error.rs              # AppError → serialized String for frontend
  commands.rs           # Utility commands (ping)

  features/             # Feature modules — Flutter features-first pattern
    tasks/
      mod.rs            # pub use commands::*
      models.rs         # Input DTOs: CreateTaskInput, UpdateTaskInput, TaskFilter
      repository.rs     # All sqlx queries (pub(super)) — the data layer
      commands.rs       # Thin #[tauri::command] wrappers — the IPC layer
    daily/
      mod.rs            # pub use commands::*, re-exports scheduler fns for lib.rs
      models.rs         # TodayDaily, HistoryEntry
      repository.rs     # All sqlx queries
      commands.rs       # Thin #[tauri::command] wrappers
      scheduler.rs      # pub local_today(), until_next_local_midnight(), ensure_instances_for()
    spawned/
      mod.rs            # pub use commands::*
      models.rs         # SpawnedView, CreateSpawnInput, UpdateSpawnInput
      repository.rs     # All sqlx queries including JOINs
      commands.rs       # Thin #[tauri::command] wrappers

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
