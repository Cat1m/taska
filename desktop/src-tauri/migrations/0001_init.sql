PRAGMA foreign_keys = ON;

CREATE TABLE tasks (
    id            TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL,
    context       TEXT NOT NULL CHECK (context IN ('personal','work')),
    category      TEXT NOT NULL CHECK (category IN ('daily','normal')),
    is_template   INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0,1)),
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    due_date      TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX idx_tasks_context_category ON tasks(context, category, status);
CREATE INDEX idx_tasks_is_template      ON tasks(is_template, status);

CREATE TABLE daily_instances (
    id          TEXT PRIMARY KEY NOT NULL,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    is_done     INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0,1)),
    note        TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE (task_id, date)
);

CREATE INDEX idx_daily_instances_date ON daily_instances(date);

CREATE TABLE spawned_tasks (
    id           TEXT PRIMARY KEY NOT NULL,
    template_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    title        TEXT NOT NULL,
    context      TEXT NOT NULL CHECK (context IN ('personal','work')),
    due_date     TEXT,
    is_done      INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0,1)),
    note         TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX idx_spawned_tasks_template ON spawned_tasks(template_id);
CREATE INDEX idx_spawned_tasks_done     ON spawned_tasks(is_done, due_date);
