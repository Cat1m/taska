use crate::db::AppState;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub async fn ping(state: State<'_, AppState>) -> AppResult<String> {
    let row: (i64,) = sqlx::query_as("SELECT 1").fetch_one(&state.pool).await?;
    Ok(format!("pong: {}", row.0))
}
