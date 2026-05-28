use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::models::{Category, Context, Status, Task};
use chrono::Utc;
use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    pub context: Context,
    pub category: Category,
    #[serde(default)]
    pub is_template: bool,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub context: Option<Context>,
    pub due_date: Option<Option<String>>,
    pub note: Option<Option<String>>,
}

#[derive(Debug, Deserialize, Default)]
pub struct TaskFilter {
    #[serde(default)]
    pub context: Option<Context>,
    #[serde(default)]
    pub category: Option<Category>,
    #[serde(default)]
    pub is_template: Option<bool>,
    #[serde(default)]
    pub status: Option<Status>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

async fn fetch_task(pool: &SqlitePool, id: &str) -> AppResult<Task> {
    let task = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Other(format!("task not found: {id}")))?;
    Ok(task)
}

#[tauri::command]
pub async fn create_task(
    state: State<'_, AppState>,
    input: CreateTaskInput,
) -> AppResult<Task> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Other("title required".into()));
    }

    let id = Uuid::new_v4().to_string();
    let now = now_iso();

    sqlx::query(
        "INSERT INTO tasks (id, title, context, category, is_template, status, due_date, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(title)
    .bind(input.context.as_str())
    .bind(input.category.as_str())
    .bind(input.is_template)
    .bind(input.due_date.as_deref())
    .bind(input.note.as_deref())
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    fetch_task(&state.pool, &id).await
}

#[tauri::command]
pub async fn get_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    fetch_task(&state.pool, &id).await
}

#[tauri::command]
pub async fn list_tasks(
    state: State<'_, AppState>,
    filter: Option<TaskFilter>,
) -> AppResult<Vec<Task>> {
    let f = filter.unwrap_or_default();
    let status = f.status.unwrap_or(Status::Active);

    let mut sql =
        String::from("SELECT * FROM tasks WHERE status = ?");
    if f.context.is_some() {
        sql.push_str(" AND context = ?");
    }
    if f.category.is_some() {
        sql.push_str(" AND category = ?");
    }
    if f.is_template.is_some() {
        sql.push_str(" AND is_template = ?");
    }
    sql.push_str(" ORDER BY created_at DESC");

    let mut q = sqlx::query_as::<_, Task>(&sql).bind(status.as_str());
    if let Some(c) = f.context {
        q = q.bind(c.as_str());
    }
    if let Some(c) = f.category {
        q = q.bind(c.as_str());
    }
    if let Some(t) = f.is_template {
        q = q.bind(t);
    }

    let rows = q.fetch_all(&state.pool).await?;
    Ok(rows)
}

#[tauri::command]
pub async fn update_task(
    state: State<'_, AppState>,
    input: UpdateTaskInput,
) -> AppResult<Task> {
    let current = fetch_task(&state.pool, &input.id).await?;

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
        "UPDATE tasks SET title = ?, context = ?, due_date = ?, note = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&title)
    .bind(&context)
    .bind(due_date.as_deref())
    .bind(note.as_deref())
    .bind(&now)
    .bind(&input.id)
    .execute(&state.pool)
    .await?;

    fetch_task(&state.pool, &input.id).await
}

#[tauri::command]
pub async fn archive_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    set_status(&state.pool, &id, Status::Archived).await
}

#[tauri::command]
pub async fn unarchive_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    set_status(&state.pool, &id, Status::Active).await
}

async fn set_status(pool: &SqlitePool, id: &str, status: Status) -> AppResult<Task> {
    let now = now_iso();
    let res = sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status.as_str())
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("task not found: {id}")));
    }
    fetch_task(pool, id).await
}
