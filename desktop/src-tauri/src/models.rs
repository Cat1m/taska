#![allow(dead_code)]

use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Context {
    Personal,
    Work,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Daily,
    Normal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,
    Archived,
}

impl Context {
    pub fn as_str(self) -> &'static str {
        match self {
            Context::Personal => "personal",
            Context::Work => "work",
        }
    }
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Daily => "daily",
            Category::Normal => "normal",
        }
    }
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Active => "active",
            Status::Archived => "archived",
        }
    }
}

impl std::str::FromStr for Context {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "personal" => Ok(Self::Personal),
            "work" => Ok(Self::Work),
            other => Err(AppError::Other(format!("invalid context: {other}"))),
        }
    }
}

impl std::str::FromStr for Category {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "daily" => Ok(Self::Daily),
            "normal" => Ok(Self::Normal),
            other => Err(AppError::Other(format!("invalid category: {other}"))),
        }
    }
}

impl std::str::FromStr for Status {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(AppError::Other(format!("invalid status: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub context: String,
    pub category: String,
    pub is_template: bool,
    pub status: String,
    pub due_date: Option<String>,
    pub note: Option<String>,
    pub instructions: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DailyInstance {
    pub id: String,
    pub task_id: String,
    pub date: String,
    pub is_done: bool,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SpawnedTask {
    pub id: String,
    pub template_id: String,
    pub title: String,
    pub context: String,
    pub due_date: Option<String>,
    pub is_done: bool,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
