use crate::error::AppResult;
use chrono::{Duration, Local, NaiveTime, TimeZone, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

pub fn local_today() -> String {
    Local::now().date_naive().to_string()
}

pub fn until_next_local_midnight() -> std::time::Duration {
    let now = Local::now();
    let tomorrow = now.date_naive().succ_opt().expect("date overflow");
    let target = Local
        .from_local_datetime(&tomorrow.and_time(NaiveTime::MIN))
        .single()
        .unwrap_or_else(|| now + Duration::days(1));
    let delta = target.signed_duration_since(now);
    delta.to_std().unwrap_or(std::time::Duration::from_secs(60))
}

pub async fn ensure_instances_for(pool: &SqlitePool, date: &str) -> AppResult<u64> {
    let active: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM tasks WHERE category = 'daily' AND status = 'active'",
    )
    .fetch_all(pool)
    .await?;

    let now = Utc::now().to_rfc3339();
    let mut inserted = 0u64;
    for (task_id,) in active {
        let id = Uuid::new_v4().to_string();
        let res = sqlx::query(
            "INSERT OR IGNORE INTO daily_instances (id, task_id, date, is_done, note, created_at)
             VALUES (?, ?, ?, 0, NULL, ?)",
        )
        .bind(&id)
        .bind(&task_id)
        .bind(date)
        .bind(&now)
        .execute(pool)
        .await?;
        inserted += res.rows_affected();
    }
    Ok(inserted)
}
