use crate::db::AppState;
use crate::error::AppResult;
use tauri::State;

use super::models::{CreateSpawnInput, SpawnedView, UpdateSpawnInput};
use super::repository as repo;

#[tauri::command]
pub async fn spawn_task(
    state: State<'_, AppState>,
    input: CreateSpawnInput,
) -> AppResult<SpawnedView> {
    repo::insert(&state.pool, input).await
}

#[tauri::command]
pub async fn list_spawned(
    state: State<'_, AppState>,
    include_done: Option<bool>,
) -> AppResult<Vec<SpawnedView>> {
    repo::list(&state.pool, include_done.unwrap_or(false)).await
}

#[tauri::command]
pub async fn toggle_spawned_done(
    state: State<'_, AppState>,
    id: String,
    is_done: bool,
) -> AppResult<()> {
    repo::toggle_done(&state.pool, &id, is_done).await
}

#[tauri::command]
pub async fn update_spawned(
    state: State<'_, AppState>,
    input: UpdateSpawnInput,
) -> AppResult<SpawnedView> {
    repo::update(&state.pool, input).await
}

#[tauri::command]
pub async fn delete_spawned(state: State<'_, AppState>, id: String) -> AppResult<()> {
    repo::delete(&state.pool, &id).await
}
