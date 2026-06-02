use crate::error::{AppError, AppResult};
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::models::{CreateSpawnInput, SpawnedView, UpdateSpawnInput};

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub(super) async fn find_view_by_id(pool: &SqlitePool, id: &str) -> AppResult<SpawnedView> {
    sqlx::query_as::<_, SpawnedView>(
        "SELECT s.id, s.template_id, s.title, s.context, s.due_date, s.is_done, s.note,
                s.created_at, s.updated_at,
                t.title AS template_title, t.note AS template_note
         FROM spawned_tasks s
         JOIN tasks t ON t.id = s.template_id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Other(format!("spawned task not found: {id}")))
}

pub(super) async fn insert(
    pool: &SqlitePool,
    input: CreateSpawnInput,
) -> AppResult<SpawnedView> {
    let row: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, title, context, category, status FROM tasks WHERE id = ?",
    )
    .bind(&input.template_id)
    .fetch_optional(pool)
    .await?;
    let (_, tmpl_title, tmpl_context, category, status) = row
        .ok_or_else(|| AppError::Other(format!("template not found: {}", input.template_id)))?;
    if status != "active" {
        return Err(AppError::Other("template is archived".into()));
    }
    if category != "normal" {
        return Err(AppError::Other(
            "only normal-category templates can be spawned".into(),
        ));
    }

    let title = input
        .title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(tmpl_title);
    let context = input
        .context
        .map(|c| c.as_str().to_string())
        .unwrap_or(tmpl_context);

    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    sqlx::query(
        "INSERT INTO spawned_tasks (id, template_id, title, context, due_date, is_done, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.template_id)
    .bind(&title)
    .bind(&context)
    .bind(input.due_date.as_deref())
    .bind(input.note.as_deref())
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    find_view_by_id(pool, &id).await
}

pub(super) async fn list(
    pool: &SqlitePool,
    include_done: bool,
) -> AppResult<Vec<SpawnedView>> {
    let sql = if include_done {
        "SELECT s.id, s.template_id, s.title, s.context, s.due_date, s.is_done, s.note,
                s.created_at, s.updated_at,
                t.title AS template_title, t.note AS template_note
         FROM spawned_tasks s
         JOIN tasks t ON t.id = s.template_id
         ORDER BY s.is_done ASC,
                  CASE WHEN s.due_date IS NULL THEN 1 ELSE 0 END,
                  s.due_date ASC,
                  s.created_at DESC"
    } else {
        "SELECT s.id, s.template_id, s.title, s.context, s.due_date, s.is_done, s.note,
                s.created_at, s.updated_at,
                t.title AS template_title, t.note AS template_note
         FROM spawned_tasks s
         JOIN tasks t ON t.id = s.template_id
         WHERE s.is_done = 0
         ORDER BY CASE WHEN s.due_date IS NULL THEN 1 ELSE 0 END,
                  s.due_date ASC,
                  s.created_at DESC"
    };
    let rows = sqlx::query_as::<_, SpawnedView>(sql)
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub(super) async fn toggle_done(
    pool: &SqlitePool,
    id: &str,
    is_done: bool,
) -> AppResult<()> {
    let now = now_iso();
    let res = sqlx::query(
        "UPDATE spawned_tasks SET is_done = ?, updated_at = ? WHERE id = ?",
    )
    .bind(is_done)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("spawned task not found: {id}")));
    }
    Ok(())
}

pub(super) async fn update(pool: &SqlitePool, input: UpdateSpawnInput) -> AppResult<SpawnedView> {
    let current = find_view_by_id(pool, &input.id).await?;
    let title = match input.title {
        Some(t) => {
            let trimmed = t.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Other("title cannot be empty".into()));
            }
            trimmed
        }
        None => current.title,
    };
    let context = input
        .context
        .map(|c| c.as_str().to_string())
        .unwrap_or(current.context);
    let due_date = input.due_date.unwrap_or(current.due_date);
    let note = input.note.unwrap_or(current.note);
    let now = now_iso();
    sqlx::query(
        "UPDATE spawned_tasks SET title = ?, context = ?, due_date = ?, note = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&title)
    .bind(&context)
    .bind(due_date.as_deref())
    .bind(note.as_deref())
    .bind(&now)
    .bind(&input.id)
    .execute(pool)
    .await?;
    find_view_by_id(pool, &input.id).await
}

pub(super) async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM spawned_tasks WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("spawned task not found: {id}")));
    }
    Ok(())
}
