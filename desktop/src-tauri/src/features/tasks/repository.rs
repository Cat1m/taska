use crate::error::{AppError, AppResult};
use crate::models::{Status, Task};
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::models::{CreateTaskInput, TaskFilter, UpdateTaskInput};

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub(super) async fn find_by_id(pool: &SqlitePool, id: &str) -> AppResult<Task> {
    sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Other(format!("task not found: {id}")))
}

pub(super) async fn insert(pool: &SqlitePool, input: CreateTaskInput) -> AppResult<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Other("title required".into()));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    sqlx::query(
        "INSERT INTO tasks (id, title, context, category, is_template, status,
                            due_date, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(input.context.as_str())
    .bind(input.category.as_str())
    .bind(input.is_template)
    .bind(input.due_date.as_deref())
    .bind(input.note.as_deref())
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    find_by_id(pool, &id).await
}

pub(super) async fn list(pool: &SqlitePool, filter: TaskFilter) -> AppResult<Vec<Task>> {
    let status = filter.status.unwrap_or(Status::Active);
    let mut sql = String::from("SELECT * FROM tasks WHERE status = ?");
    if filter.context.is_some() {
        sql.push_str(" AND context = ?");
    }
    if filter.category.is_some() {
        sql.push_str(" AND category = ?");
    }
    if filter.is_template.is_some() {
        sql.push_str(" AND is_template = ?");
    }
    sql.push_str(" ORDER BY created_at DESC");

    let mut q = sqlx::query_as::<_, Task>(&sql).bind(status.as_str());
    if let Some(c) = filter.context {
        q = q.bind(c.as_str());
    }
    if let Some(c) = filter.category {
        q = q.bind(c.as_str());
    }
    if let Some(t) = filter.is_template {
        q = q.bind(t);
    }
    Ok(q.fetch_all(pool).await?)
}

pub(super) async fn update(pool: &SqlitePool, input: UpdateTaskInput) -> AppResult<Task> {
    let current = find_by_id(pool, &input.id).await?;
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
    let category = input
        .category
        .map(|c| c.as_str().to_string())
        .unwrap_or(current.category);
    let is_template = input.is_template.unwrap_or(current.is_template);
    let due_date = input.due_date.unwrap_or(current.due_date);
    let note = input.note.unwrap_or(current.note);
    let now = now_iso();
    sqlx::query(
        "UPDATE tasks SET title = ?, context = ?, category = ?, is_template = ?, due_date = ?, note = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&title)
    .bind(&context)
    .bind(&category)
    .bind(is_template)
    .bind(due_date.as_deref())
    .bind(note.as_deref())
    .bind(&now)
    .bind(&input.id)
    .execute(pool)
    .await?;
    find_by_id(pool, &input.id).await
}

pub(super) async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Other(format!("task not found: {id}")));
    }
    Ok(())
}

pub(super) async fn set_status(pool: &SqlitePool, id: &str, status: Status) -> AppResult<Task> {
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
    find_by_id(pool, id).await
}
