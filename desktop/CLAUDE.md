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
- New Tauri command: define `#[tauri::command]` fn in relevant module (tasks/spawned/daily) → register in `invoke_handler` in `lib.rs`
- Migrations: add `NNNN_name.sql` to `src-tauri/migrations/` — sqlx runs in filename order on startup
- Keep commands thin: put business logic in helper fns, not directly in `#[tauri::command]`

### Frontend ↔ Rust Contract
- Every `invoke()` call must have a matching TypeScript type annotation
- Rust enums serialize as lowercase strings (serde) — TS types must match exactly
- Errors surface as serialized String from `AppError` — frontend catches as `string`
- Command names in `invoke("name")` match Rust fn names (snake_case → snake_case)
- All backend calls go through `invoke()` from `@tauri-apps/api/core`
