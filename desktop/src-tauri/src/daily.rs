use crate::db::AppState;
use crate::error::{AppError, AppResult};
use chrono::{Duration, Local, NaiveTime, TimeZone, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct HistoryEntry {
    pub id: String,            // daily_instance id
    pub task_id: String,
    pub task_title: String,
    pub context: String,
    pub task_status: String,   // 'active' or 'archived'
    pub date: String,
    pub is_done: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TodayDaily {
    pub id: String,           // instance id (daily) or task id (normal)
    pub task_id: String,
    pub title: String,
    pub context: String,
    pub is_template: bool,
    pub template_note: Option<String>,
    pub date: String,
    pub is_done: bool,
    pub note: Option<String>,
    pub created_at: String,
    pub kind: String,         // "daily" | "normal"
}

pub fn local_today() -> String {
    Local::now().date_naive().to_string()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Create a DailyInstance for every active daily Task for the given local date,
/// skipping rows that already exist (UNIQUE constraint on task_id, date).
pub async fn ensure_instances_for(pool: &SqlitePool, date: &str) -> AppResult<u64> {
    let active: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM tasks WHERE category = 'daily' AND status = 'active'",
    )
    .fetch_all(pool)
    .await?;

    let now = now_iso();
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

#[tauri::command]
pub async fn ensure_today_instances(state: State<'_, AppState>) -> AppResult<u64> {
    ensure_instances_for(&state.pool, &local_today()).await
}

#[tauri::command]
pub async fn list_today_daily(state: State<'_, AppState>) -> AppResult<Vec<TodayDaily>> {
    let today = local_today();
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
    .bind(&today)
    .bind(&today)
    .bind(&today)
    .bind(&today)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn toggle_normal_task_today(
    state: State<'_, AppState>,
    task_id: String,
    is_done: bool,
) -> AppResult<()> {
    let today = local_today();
    let now = now_iso();
    let id = Uuid::new_v4().to_string();
    // Insert row if not exists, then update is_done
    sqlx::query(
        "INSERT INTO daily_instances (id, task_id, date, is_done, note, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(task_id, date) DO UPDATE SET is_done = excluded.is_done",
    )
    .bind(&id)
    .bind(&task_id)
    .bind(&today)
    .bind(is_done)
    .bind(&now)
    .execute(&state.pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_daily_history(
    state: State<'_, AppState>,
    days: Option<i64>,
) -> AppResult<Vec<HistoryEntry>> {
    let days = days.unwrap_or(30).clamp(1, 365);
    let today = Local::now().date_naive();
    let from = today - Duration::days(days - 1);
    let from_s = from.to_string();
    let to_s = today.to_string();

    let rows = sqlx::query_as::<_, HistoryEntry>(
        "SELECT di.id, di.task_id, t.title AS task_title, t.context, t.status AS task_status,
                di.date, di.is_done, di.note
         FROM daily_instances di
         JOIN tasks t ON t.id = di.task_id
         WHERE di.date BETWEEN ? AND ?
         ORDER BY t.context, t.title, di.date",
    )
    .bind(&from_s)
    .bind(&to_s)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn list_daily_history_between(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<HistoryEntry>> {
    let rows = sqlx::query_as::<_, HistoryEntry>(
        "SELECT di.id, di.task_id, t.title AS task_title, t.context, t.status AS task_status,
                di.date, di.is_done, di.note
         FROM daily_instances di
         JOIN tasks t ON t.id = di.task_id
         WHERE di.date BETWEEN ? AND ?
         ORDER BY t.context, t.title, di.date",
    )
    .bind(&from)
    .bind(&to)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn toggle_daily_done(
    state: State<'_, AppState>,
    id: String,
    is_done: bool,
) -> AppResult<()> {
    let res = sqlx::query("UPDATE daily_instances SET is_done = ? WHERE id = ?")
        .bind(is_done)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("daily instance not found: {id}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_daily_note(
    state: State<'_, AppState>,
    id: String,
    note: Option<String>,
) -> AppResult<()> {
    let note = note.and_then(|s| if s.trim().is_empty() { None } else { Some(s) });
    let res = sqlx::query("UPDATE daily_instances SET note = ? WHERE id = ?")
        .bind(note.as_deref())
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("daily instance not found: {id}")));
    }
    Ok(())
}

/// Compute the duration from `now` until next local midnight (start of tomorrow).
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
