# Scaffold a new Tauri feature module

Scaffold a new backend feature following the project's features-first pattern.

**Usage:** `/new-feature <name>`  
Example: `/new-feature notifications`

## What to generate

Given feature name `$ARGUMENTS` (snake_case), create these 4 files under
`src-tauri/src/features/<name>/`:

### `mod.rs`
```rust
mod commands;
mod models;
mod repository;

pub use commands::*;
```

### `models.rs`
```rust
use serde::{Deserialize, Serialize};
// Import shared enums only if needed:
// use crate::models::{Category, Context, Status};

/// Input DTO for creating a <Name>.
#[derive(Debug, Deserialize)]
pub struct Create<Name>Input {
    pub title: String,
    // add fields
}

/// Output type returned to the frontend.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct <Name> {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}
```

### `repository.rs`
```rust
use crate::error::{AppError, AppResult};
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::models::{Create<Name>Input, <Name>};

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub(super) async fn find_by_id(pool: &SqlitePool, id: &str) -> AppResult<<Name>> {
    sqlx::query_as::<_, <Name>>("SELECT * FROM <table> WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Other(format!("<name> not found: {id}")))
}

pub(super) async fn insert(pool: &SqlitePool, input: Create<Name>Input) -> AppResult<<Name>> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Other("title required".into()));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    sqlx::query("INSERT INTO <table> (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&title)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;
    find_by_id(pool, &id).await
}
```

### `commands.rs`
```rust
use crate::db::AppState;
use crate::error::AppResult;
use tauri::State;

use super::models::{Create<Name>Input, <Name>};
use super::repository as repo;

#[tauri::command]
pub async fn create_<name>(
    state: State<'_, AppState>,
    input: Create<Name>Input,
) -> AppResult<<Name>> {
    repo::insert(&state.pool, input).await
}

#[tauri::command]
pub async fn get_<name>(state: State<'_, AppState>, id: String) -> AppResult<<Name>> {
    repo::find_by_id(&state.pool, &id).await
}
```

## After generating files

1. Add `pub mod <name>;` to `src-tauri/src/features/mod.rs`
2. Register commands in `src-tauri/src/lib.rs` invoke_handler:
   ```rust
   features::<name>::create_<name>,
   features::<name>::get_<name>,
   ```
3. Create migration if needed: `src-tauri/migrations/NNNN_<name>.sql`
4. Run `cd src-tauri && cargo check` to verify

## Pattern rules to follow

- `commands.rs`: max 3-5 lines per command — extract pool, call repo, return. NO SQL here.
- `repository.rs`: all functions are `pub(super)`. NO Tauri types (`State`, `AppState`) here.
- `models.rs`: input structs derive `Deserialize`, output structs derive `Serialize + sqlx::FromRow`.
- Shared enums (`Context`, `Category`, `Status`) import from `crate::models`, not redefined.
