use crate::error::{AppError, AppResult};
use chrono::{Duration, Local, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::models::{HistoryEntry, TodayDaily};

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub(super) async fn list_today(pool: &SqlitePool, today: &str) -> AppResult<Vec<TodayDaily>> {
    let rows = sqlx::query_as::<_, TodayDaily>(
        "SELECT di.id, di.task_id, t.title, t.context, t.is_template,
                t.note AS template_note,
                di.date, di.is_done, di.note, di.created_at,
                'daily' AS kind
         FROM daily_instances di
         JOIN tasks t ON t.id = di.task_id
         WHERE di.date = ?

         UNION ALL

         SELECT t.id, t.id AS task_id, t.title, t.context, t.is_template,
                t.note AS template_note,
                ? AS date,
                COALESCE(di.is_done, 0) AS is_done,
                di.note AS note,
                t.created_at,
                'normal' AS kind
         FROM tasks t
         LEFT JOIN daily_instances di ON di.task_id = t.id AND di.date = ?
         WHERE t.category = 'normal'
           AND t.status = 'active'
           AND t.due_date = ?

         ORDER BY context, title",
    )
    .bind(today)
    .bind(today)
    .bind(today)
    .bind(today)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub(super) async fn toggle_done(pool: &SqlitePool, id: &str, is_done: bool) -> AppResult<()> {
    let res = sqlx::query("UPDATE daily_instances SET is_done = ? WHERE id = ?")
        .bind(is_done)
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("daily instance not found: {id}")));
    }
    Ok(())
}

pub(super) async fn set_note(
    pool: &SqlitePool,
    id: &str,
    note: Option<String>,
) -> AppResult<()> {
    let note = note.and_then(|s| if s.trim().is_empty() { None } else { Some(s) });
    let res = sqlx::query("UPDATE daily_instances SET note = ? WHERE id = ?")
        .bind(note.as_deref())
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("daily instance not found: {id}")));
    }
    Ok(())
}

pub(super) async fn toggle_normal_today(
    pool: &SqlitePool,
    task_id: &str,
    today: &str,
    is_done: bool,
) -> AppResult<()> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    sqlx::query(
        "INSERT INTO daily_instances (id, task_id, date, is_done, note, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(task_id, date) DO UPDATE SET is_done = excluded.is_done",
    )
    .bind(&id)
    .bind(task_id)
    .bind(today)
    .bind(is_done)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn remove_instance(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM daily_instances WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("instance not found: {id}")));
    }
    Ok(())
}

pub(super) async fn history(pool: &SqlitePool, days: i64) -> AppResult<Vec<HistoryEntry>> {
    let days = days.clamp(1, 365);
    let today = Local::now().date_naive();
    let from = today - Duration::days(days - 1);
    let rows = sqlx::query_as::<_, HistoryEntry>(
        "SELECT di.id, di.task_id, t.title AS task_title, t.context, t.status AS task_status,
                di.date, di.is_done, di.note
         FROM daily_instances di
         JOIN tasks t ON t.id = di.task_id
         WHERE di.date BETWEEN ? AND ?
         ORDER BY t.context, t.title, di.date",
    )
    .bind(from.to_string())
    .bind(today.to_string())
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub(super) async fn history_between(
    pool: &SqlitePool,
    from: &str,
    to: &str,
) -> AppResult<Vec<HistoryEntry>> {
    let rows = sqlx::query_as::<_, HistoryEntry>(
        "SELECT di.id, di.task_id, t.title AS task_title, t.context, t.status AS task_status,
                di.date, di.is_done, di.note
         FROM daily_instances di
         JOIN tasks t ON t.id = di.task_id
         WHERE di.date BETWEEN ? AND ?
         ORDER BY t.context, t.title, di.date",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
