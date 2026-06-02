# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Taska** is a Tauri 2.x desktop app for task and daily habit tracking. Vanilla TypeScript frontend (Vite), Rust + SQLite backend.

@.claude/architecture.md

## Commands

```bash
npm run tauri dev     # Full app with hot reload — run from desktop/
npm run dev           # Frontend only (Vite on port 1420)
npm run build         # tsc + vite build
npm run tauri build   # Production binary
```

## Working Rules

### Workflow
- Quick Rust type/borrow check (no build): `cd src-tauri && cargo check`
- Rust lints: `cd src-tauri && cargo clippy`
- Rust tests: `cd src-tauri && cargo test`
- TS type check only: `npx tsc --noEmit`
- Rust changes require restarting `tauri dev`; frontend hot-reloads automatically

### Rust Conventions
- Errors: always use `AppError` (thiserror) in `error.rs` — never return raw String from a command
- Migrations: add `NNNN_name.sql` to `src-tauri/migrations/` — sqlx runs in filename order on startup

### Feature-First Pattern (Flutter analogy)
Backend follows a features-first structure. Every feature lives in `src-tauri/src/features/<name>/` with 4 fixed files:

| File | Responsibility | Flutter analogy |
|---|---|---|
| `commands.rs` | `#[tauri::command]` fns only — call repo, return result | `presentation/BLoC` |
| `repository.rs` | All sqlx queries, `pub(super)` — no Tauri types | `data/repository` |
| `models.rs` | Input DTOs (Deserialize) and output types (Serialize) | `domain/models` |
| `mod.rs` | `pub use commands::*;` and re-exports needed by `lib.rs` | barrel file |

**Rules — enforce strictly when generating code:**
1. `commands.rs` must NEVER contain SQL. Max 3-5 lines per command: extract pool, call `repo::fn`, return.
2. `repository.rs` functions are `pub(super)` — only callable from within the same feature.
3. Shared enums (`Context`, `Category`, `Status`) live in root `models.rs`, not in feature models.
4. New commands go in the relevant feature's `commands.rs`, then register in `lib.rs` `invoke_handler` as `features::<name>::<fn>`.
5. `error.rs` and `db.rs` stay at root — imported as `crate::error::*` and `crate::db::AppState`.

**Adding a new feature:**
Use `/new-feature <name>` to scaffold the 4 files automatically.

### Frontend ↔ Rust Contract
- Every `invoke()` call must have a matching TypeScript type annotation
- Rust enums serialize as lowercase strings (serde) — TS types must match exactly
- Errors surface as serialized String from `AppError` — frontend catches as `string`
- Command names in `invoke("name")` match Rust fn names (snake_case → snake_case)
- All backend calls go through `invoke()` from `@tauri-apps/api/core`
