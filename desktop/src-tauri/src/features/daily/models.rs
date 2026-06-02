use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct HistoryEntry {
    pub id: String,
    pub task_id: String,
    pub task_title: String,
    pub context: String,
    pub task_status: String,
    pub date: String,
    pub is_done: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TodayDaily {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub context: String,
    pub is_template: bool,
    pub template_note: Option<String>,
    pub date: String,
    pub is_done: bool,
    pub note: Option<String>,
    pub created_at: String,
    pub kind: String, // "daily" | "normal"
}
