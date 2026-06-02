use crate::error::AppResult;
use sqlx::SqlitePool;

pub(super) async fn get(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub(super) async fn set(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}
