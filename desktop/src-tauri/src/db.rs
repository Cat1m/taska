use crate::error::{AppError, AppResult};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::str::FromStr;
use tauri::Manager;

pub struct AppState {
    pub pool: SqlitePool,
}

pub async fn init_db(app: &tauri::AppHandle) -> AppResult<SqlitePool> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("resolve app_data_dir: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;

    let db_path = data_dir.join("taska.db");
    let url = format!("sqlite://{}", db_path.to_string_lossy());

    let opts = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}
