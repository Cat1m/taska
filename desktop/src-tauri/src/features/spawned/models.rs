use crate::models::Context;
use serde::{Deserialize, Serialize};

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
