use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::models::Context;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SpawnedView {
    pub id: String,
    pub template_id: String,
    pub title: String,
    pub context: String,
    pub due_date: Option<String>,
    pub is_done: bool,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub template_title: String,
    pub template_note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSpawnInput {
    pub template_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub context: Option<Context>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSpawnInput {
    pub id: String,
    pub title: Option<String>,
    pub context: Option<Context>,
    pub due_date: Option<Option<String>>,
    pub note: Option<Option<String>>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

async fn fetch_view(pool: &sqlx::SqlitePool, id: &str) -> AppResult<SpawnedView> {
    let row = sqlx::query_as::<_, SpawnedView>(
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
    .ok_or_else(|| AppError::Other(format!("spawned task not found: {id}")))?;
    Ok(row)
}

#[tauri::command]
pub async fn spawn_task(
    state: State<'_, AppState>,
    input: CreateSpawnInput,
) -> AppResult<SpawnedView> {
    // Validate template: must exist, be a template, normal category, active.
    let row: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, title, context, category, status FROM tasks WHERE id = ?",
    )
    .bind(&input.template_id)
    .fetch_optional(&state.pool)
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
    .execute(&state.pool)
    .await?;

    fetch_view(&state.pool, &id).await
}

#[tauri::command]
pub async fn list_spawned(
    state: State<'_, AppState>,
    include_done: Option<bool>,
) -> AppResult<Vec<SpawnedView>> {
    let include_done = include_done.unwrap_or(false);
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
        .fetch_all(&state.pool)
        .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn toggle_spawned_done(
    state: State<'_, AppState>,
    id: String,
    is_done: bool,
) -> AppResult<()> {
    let now = now_iso();
    let res = sqlx::query(
        "UPDATE spawned_tasks SET is_done = ?, updated_at = ? WHERE id = ?",
    )
    .bind(is_done)
    .bind(&now)
    .bind(&id)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("spawned task not found: {id}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn update_spawned(
    state: State<'_, AppState>,
    input: UpdateSpawnInput,
) -> AppResult<SpawnedView> {
    let current = fetch_view(&state.pool, &input.id).await?;

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
    let context = match input.context {
        Some(c) => c.as_str().to_string(),
        None => current.context,
    };
    let due_date = match input.due_date {
        Some(v) => v,
        None => current.due_date,
    };
    let note = match input.note {
        Some(v) => v,
        None => current.note,
    };
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
    .execute(&state.pool)
    .await?;

    fetch_view(&state.pool, &input.id).await
}

#[tauri::command]
pub async fn delete_spawned(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM spawned_tasks WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("spawned task not found: {id}")));
    }
    Ok(())
}
