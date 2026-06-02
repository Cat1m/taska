use crate::models::{Category, Context, Status};
use serde::Deserialize;

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
    pub category: Option<Category>,
    #[serde(default)]
    pub is_template: Option<bool>,
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
