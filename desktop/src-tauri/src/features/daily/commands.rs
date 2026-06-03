use crate::db::AppState;
use crate::error::AppResult;
use tauri::State;

use super::models::{HistoryEntry, TodayDaily};
use super::repository as repo;
use super::scheduler::{ensure_instances_for, local_today};

#[tauri::command]
pub async fn ensure_today_instances(state: State<'_, AppState>) -> AppResult<u64> {
    ensure_instances_for(&state.pool, &local_today()).await
}

#[tauri::command]
pub async fn list_today_daily(state: State<'_, AppState>) -> AppResult<Vec<TodayDaily>> {
    repo::list_today(&state.pool, &local_today()).await
}

#[tauri::command]
pub async fn list_daily_for_date(
    state: State<'_, AppState>,
    date: String,
) -> AppResult<Vec<TodayDaily>> {
    ensure_instances_for(&state.pool, &date).await?;
    repo::list_today(&state.pool, &date).await
}

#[tauri::command]
pub async fn toggle_daily_done(
    state: State<'_, AppState>,
    id: String,
    is_done: bool,
) -> AppResult<()> {
    repo::toggle_done(&state.pool, &id, is_done).await
}

#[tauri::command]
pub async fn set_daily_note(
    state: State<'_, AppState>,
    id: String,
    note: Option<String>,
) -> AppResult<()> {
    repo::set_note(&state.pool, &id, note).await
}

#[tauri::command]
pub async fn toggle_normal_task_today(
    state: State<'_, AppState>,
    task_id: String,
    is_done: bool,
) -> AppResult<()> {
    repo::toggle_normal_today(&state.pool, &task_id, &local_today(), is_done).await
}

#[tauri::command]
pub async fn set_normal_task_note(
    state: State<'_, AppState>,
    task_id: String,
    date: String,
    note: Option<String>,
) -> AppResult<()> {
    repo::set_note_for_normal_task(&state.pool, &task_id, &date, note).await
}

#[tauri::command]
pub async fn remove_from_today(
    state: State<'_, AppState>,
    task_id: String,
    date: String,
) -> AppResult<()> {
    repo::remove_from_today(&state.pool, &task_id, &date).await
}

#[tauri::command]
pub async fn list_daily_history(
    state: State<'_, AppState>,
    days: Option<i64>,
) -> AppResult<Vec<HistoryEntry>> {
    repo::history(&state.pool, days.unwrap_or(30)).await
}

#[tauri::command]
pub async fn list_daily_history_between(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<HistoryEntry>> {
    repo::history_between(&state.pool, &from, &to).await
}
