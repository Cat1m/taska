use crate::db::AppState;
use crate::error::AppResult;
use tauri::State;

use super::repository as repo;

#[tauri::command]
pub async fn get_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    repo::get(&state.pool, &key).await
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    repo::set(&state.pool, &key, &value).await
}
