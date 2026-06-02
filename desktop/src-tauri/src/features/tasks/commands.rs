use crate::db::AppState;
use crate::error::AppResult;
use crate::models::{Status, Task};
use tauri::State;

use super::models::{CreateTaskInput, TaskFilter, UpdateTaskInput};
use super::repository as repo;

#[tauri::command]
pub async fn create_task(state: State<'_, AppState>, input: CreateTaskInput) -> AppResult<Task> {
    repo::insert(&state.pool, input).await
}

#[tauri::command]
pub async fn get_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    repo::find_by_id(&state.pool, &id).await
}

#[tauri::command]
pub async fn list_tasks(
    state: State<'_, AppState>,
    filter: Option<TaskFilter>,
) -> AppResult<Vec<Task>> {
    repo::list(&state.pool, filter.unwrap_or_default()).await
}

#[tauri::command]
pub async fn update_task(state: State<'_, AppState>, input: UpdateTaskInput) -> AppResult<Task> {
    repo::update(&state.pool, input).await
}

#[tauri::command]
pub async fn archive_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    repo::set_status(&state.pool, &id, Status::Archived).await
}

#[tauri::command]
pub async fn unarchive_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    repo::set_status(&state.pool, &id, Status::Active).await
}
