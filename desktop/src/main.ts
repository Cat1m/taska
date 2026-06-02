import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ─── Types ────────────────────────────────────────────────

type Context  = "personal" | "work";
type Category = "daily" | "normal";
type Status   = "active" | "archived";
type ViewName = "myday" | "tasks" | "spawned" | "daily";

interface Task {
  id: string;
  title: string;
  context: Context;
  category: Category;
  is_template: boolean;
  status: Status;
  due_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface Spawned {
  id: string;
  template_id: string;
  title: string;
  context: Context;
  due_date: string | null;
  is_done: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  template_title: string;
  template_note: string | null;
}

interface TodayDaily {
  id: string;
  task_id: string;
  title: string;
  context: Context;
  is_template: boolean;
  template_note: string | null;
  date: string;
  is_done: boolean;
  note: string | null;
  created_at: string;
  kind: "daily" | "normal";
}

interface HistoryEntry {
  id: string;
  task_id: string;
  task_title: string;
  context: Context;
  task_status: Status;
  date: string;
  is_done: boolean;
  note: string | null;
}

// ─── App state ────────────────────────────────────────────

let currentView: ViewName = "myday";
let myDayFilter: "all" | "personal" | "work" = "all";
let myDayInstances: TodayDaily[] = [];
const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();

let taskFilter: "active" | "archived" = "active";
let taskSearch = "";
let tasksList: Task[] = [];

let editingTask: Task | null = null;
let spawnTemplates: Task[] = [];
let spawnFromTaskId: string | null = null;

// ─── Helpers ──────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDateLong(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function formatShortDate(ts: string): string {
  return new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/** Due-date display helpers for Tasks view */
function dueMeta(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: "—", cls: "" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0)  return { text: `${-diff}d overdue`, cls: "over" };
  if (diff === 0) return { text: "today",             cls: "soon" };
  if (diff === 1) return { text: "tomorrow",          cls: "soon" };
  if (diff <= 2)  return { text: `in ${diff}d`,       cls: "soon" };
  return { text: `in ${diff}d`, cls: "" };
}

function dateLevel(done: number, total: number): number {
  if (total === 0) return 0;
  const r = done / total;
  if (r === 0)   return 0;
  if (r <= 0.25) return 1;
  if (r <= 0.5)  return 2;
  if (r < 1)     return 3;
  return 4;
}

function calcBestStreak(dateMap: Map<string, { done: number; total: number }>): number {
  const dates = Array.from(dateMap.entries())
    .filter(([, g]) => g.done > 0)
    .map(([d]) => d)
    .sort();
  if (dates.length === 0) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(dates[i-1] + "T00:00:00");
    const b = new Date(dates[i]   + "T00:00:00");
    if ((b.getTime() - a.getTime()) / 86400000 === 1) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

function badge(cls: string, text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = `badge ${cls}`;
  el.textContent = text;
  return el;
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// ─── Theme ────────────────────────────────────────────────

const THEME_KEY = "taska-theme";

function applyTheme(t: "dark" | "light") {
  const html = document.documentElement;
  html.classList.add("theme-transitioning");
  html.dataset.theme = t === "light" ? "light" : "";
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = t === "light" ? "◑ dark" : "◐ light";
  setTimeout(() => html.classList.remove("theme-transitioning"), 250);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next: "dark" | "light" = current === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ─── View navigation ──────────────────────────────────────

function setView(v: ViewName) {
  currentView = v;
  document.querySelectorAll<HTMLElement>(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.goto === v);
  });
  document.querySelectorAll<HTMLElement>(".view").forEach(el => {
    el.classList.toggle("active", el.dataset.view === v);
  });
  if (v === "tasks")   loadTasks();
  if (v === "spawned") loadSpawned();
  if (v === "daily")   loadDaily();
}

// ─── My Day ───────────────────────────────────────────────

async function loadMyDay() {
  try {
    myDayInstances = await invoke<TodayDaily[]>("list_today_daily");
  } catch (e) {
    console.error("list_today_daily:", e);
    myDayInstances = [];
  }
  renderMyDay();
  refreshMyDayPills();
}

function renderMyDay() {
  const filtered = myDayFilter === "all"
    ? myDayInstances
    : myDayInstances.filter(i => i.context === myDayFilter);

  updateMyDayMeta();

  const list = document.getElementById("myday-list")!;
  list.innerHTML = "";
  if (filtered.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.textContent = myDayFilter === "all"
      ? "No daily tasks today. Create one with + New."
      : `No ${myDayFilter} tasks today.`;
    list.appendChild(el);
    return;
  }
  for (const inst of filtered) list.appendChild(buildInstanceRow(inst));
}

function buildInstanceRow(inst: TodayDaily): HTMLElement {
  const row = document.createElement("div");
  row.className = `instance-row${inst.is_done ? " is-done" : ""}`;
  row.id = `row-${inst.id}`;

  const chkWrap = document.createElement("label");
  chkWrap.className = "chk-wrap";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.className = "chk";
  chk.checked = inst.is_done;
  chk.addEventListener("change", () => toggleDone(inst.id, chk.checked));
  chkWrap.appendChild(chk);
  row.appendChild(chkWrap);

  const body = document.createElement("div");
  body.className = "instance-body";

  const titleRow = document.createElement("div");
  titleRow.className = "instance-title-row";
  const titleEl = document.createElement("span");
  titleEl.className = `instance-title${inst.is_done ? " done" : ""}`;
  titleEl.textContent = inst.title;
  titleRow.appendChild(titleEl);
  titleRow.appendChild(badge(`ctx-${inst.context}`, inst.context));
  body.appendChild(titleRow);

  const noteArea = document.createElement("textarea");
  noteArea.className = "note-field";
  noteArea.placeholder = "note for today…";
  noteArea.rows = 1;
  noteArea.value = inst.note ?? "";
  const saveStatus = document.createElement("span");
  saveStatus.className = "save-status";
  noteArea.addEventListener("input", () => {
    autoResize(noteArea);
    scheduleNoteSave(inst.id, noteArea.value, saveStatus);
  });
  body.appendChild(noteArea);
  body.appendChild(saveStatus);
  row.appendChild(body);

  requestAnimationFrame(() => autoResize(noteArea));
  return row;
}

async function toggleDone(id: string, done: boolean) {
  const inst = myDayInstances.find(i => i.id === id);
  if (inst) inst.is_done = done;

  const row = document.getElementById(`row-${id}`);
  if (row) {
    row.classList.toggle("is-done", done);
    row.querySelector(".instance-title")?.classList.toggle("done", done);
  }
  updateMyDayMeta();
  refreshMyDayPills();

  try {
    if (inst?.kind === "normal") {
      await invoke("toggle_normal_task_today", { taskId: inst.task_id, isDone: done });
    } else {
      await invoke("toggle_daily_done", { id, isDone: done });
    }
  } catch (e) {
    if (inst) inst.is_done = !done;
    if (row) {
      row.classList.toggle("is-done", !done);
      row.querySelector(".instance-title")?.classList.toggle("done", !done);
      const c = row.querySelector<HTMLInputElement>(".chk");
      if (c) c.checked = !done;
    }
    updateMyDayMeta();
    refreshMyDayPills();
    console.error("toggleDone:", e);
  }
}

function updateMyDayMeta() {
  const done  = myDayInstances.filter(i => i.is_done).length;
  const total = myDayInstances.length;
  document.getElementById("myday-meta")!.textContent = total > 0 ? `${done}/${total} done` : "";
}

function refreshMyDayPills() {
  const done   = myDayInstances.filter(i => i.is_done).length;
  const total  = myDayInstances.length;
  const undone = total - done;
  const mydayPill = document.getElementById("cnt-myday")!;
  mydayPill.textContent = undone > 0 ? String(undone) : "";
  const dailyPill = document.getElementById("cnt-daily")!;
  dailyPill.textContent = total > 0 ? `${done}/${total}` : "";
}

function scheduleNoteSave(id: string, note: string, statusEl: HTMLSpanElement) {
  const existing = noteTimers.get(id);
  if (existing) clearTimeout(existing);

  statusEl.textContent = "saving…";
  statusEl.className = "save-status saving";
  const hint = document.getElementById("autosave-hint")!;
  hint.textContent = "saving…";
  hint.className = "autosave-hint saving";

  const timer = setTimeout(async () => {
    noteTimers.delete(id);
    try {
      const trimmed = note.trim();
      await invoke("set_daily_note", { id, note: trimmed || null });
      const inst = myDayInstances.find(i => i.id === id);
      if (inst) inst.note = trimmed || null;
      statusEl.textContent = "✓ saved";
      statusEl.className = "save-status saved";
      hint.textContent = "✓ saved";
      hint.className = "autosave-hint saved";
      setTimeout(() => {
        if (statusEl.textContent === "✓ saved") { statusEl.textContent = ""; statusEl.className = "save-status"; }
        if (hint.textContent === "✓ saved") { hint.textContent = ""; hint.className = "autosave-hint"; }
      }, 1400);
    } catch (e) {
      statusEl.textContent = "⚠ error";
      statusEl.className = "save-status";
      hint.textContent = "⚠ save failed";
      hint.className = "autosave-hint";
      console.error("set_daily_note:", e);
    }
  }, 500);
  noteTimers.set(id, timer);
}

// ─── Tasks view ───────────────────────────────────────────

async function loadTasks() {
  try {
    tasksList = await invoke<Task[]>("list_tasks", { filter: { status: taskFilter } });
  } catch (e) {
    console.error("list_tasks:", e);
    tasksList = [];
  }
  renderTasks();
}

function renderTasks() {
  const needle = taskSearch.toLowerCase();
  const filtered = needle
    ? tasksList.filter(t =>
        t.title.toLowerCase().includes(needle) ||
        (t.note ?? "").toLowerCase().includes(needle)
      )
    : tasksList;

  const list = document.getElementById("tasks-list")!;
  list.innerHTML = "";

  if (filtered.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.textContent = needle
      ? "No tasks match your search."
      : taskFilter === "active" ? "No active tasks." : "No archived tasks.";
    list.appendChild(el);
    return;
  }
  for (const t of filtered) list.appendChild(buildTaskRow(t));
}

function buildTaskRow(t: Task): HTMLElement {
  const row = document.createElement("div");
  row.className = `task-row${t.status === "archived" ? " is-archived" : ""}`;

  // Checkbox: checked = archived
  const chkWrap = document.createElement("label");
  chkWrap.className = "chk-wrap";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.className = "chk";
  chk.checked = t.status === "archived";
  chk.addEventListener("change", async () => {
    try {
      await invoke(chk.checked ? "archive_task" : "unarchive_task", { id: t.id });
      await loadTasks();
      await updateNavCounts();
    } catch (e) {
      chk.checked = !chk.checked;
      console.error(e);
    }
  });
  chkWrap.appendChild(chk);
  row.appendChild(chkWrap);

  // Task main: title + note preview
  const main = document.createElement("div");
  main.className = "task-main";
  const titleEl = document.createElement("span");
  titleEl.className = "task-title-text";
  titleEl.textContent = t.title;
  main.appendChild(titleEl);
  if (t.note) {
    const preview = document.createElement("span");
    preview.className = "task-note-preview";
    preview.textContent = `› ${t.note.slice(0, 80)}`;
    main.appendChild(preview);
  }
  row.appendChild(main);

  // Tags: context + category + template badge + spawn button for normal templates
  const tags = document.createElement("div");
  tags.className = "task-tags";
  tags.appendChild(badge(`ctx-${t.context}`, t.context));
  tags.appendChild(badge(`cat-${t.category}`, t.category));
  if (t.is_template) {
    tags.appendChild(badge("b-template", "template"));
    if (t.category === "normal") {
      const spawnBtn = document.createElement("button");
      spawnBtn.className = "spawn-inline-btn";
      spawnBtn.textContent = "⑂ spawn";
      spawnBtn.title = "Spawn an instance from this template";
      spawnBtn.addEventListener("click", e => {
        e.stopPropagation();
        openSpawnModal(t.id);
      });
      tags.appendChild(spawnBtn);
    }
  }
  row.appendChild(tags);

  // Due
  const dueCell = document.createElement("div");
  dueCell.className = "task-due";
  const { text, cls } = dueMeta(t.due_date);
  const dueEl = document.createElement("span");
  dueEl.className = `due-text${cls ? " " + cls : ""}`;
  dueEl.textContent = text;
  dueCell.appendChild(dueEl);
  row.appendChild(dueCell);

  // Row click → edit modal (ignore checkbox clicks)
  row.addEventListener("click", e => {
    if ((e.target as HTMLElement).closest(".chk-wrap")) return;
    openEditModal(t);
  });

  return row;
}

// ─── Spawned view ─────────────────────────────────────────

async function loadSpawned() {
  let spawned: Spawned[] = [];
  try {
    spawned = await invoke<Spawned[]>("list_spawned", { includeDone: true });
  } catch (e) {
    console.error("list_spawned:", e);
  }
  renderSpawned(spawned);

  const active = spawned.filter(s => !s.is_done).length;
  document.getElementById("cnt-spawned")!.textContent = active > 0 ? String(active) : "";
}

function renderSpawned(spawned: Spawned[]) {
  const list = document.getElementById("spawned-list")!;
  list.innerHTML = "";

  if (spawned.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.textContent = "No spawned instances. Use ⑂ Spawn from template… to create one.";
    list.appendChild(el);
    return;
  }

  // Group by template_id
  type Group = { templateTitle: string; context: Context; items: Spawned[] };
  const groups = new Map<string, Group>();
  for (const s of spawned) {
    if (!groups.has(s.template_id)) {
      groups.set(s.template_id, { templateTitle: s.template_title, context: s.context, items: [] });
    }
    groups.get(s.template_id)!.items.push(s);
  }

  for (const [, g] of groups) {
    list.appendChild(buildSpawnGroup(g));
  }
}

function buildSpawnGroup(g: { templateTitle: string; context: Context; items: Spawned[] }): HTMLElement {
  const container = document.createElement("div");
  container.className = "spawn-group";

  const head = document.createElement("div");
  head.className = "spawn-group-head";

  const icon = document.createElement("span");
  icon.className = "spawn-group-icon";
  icon.textContent = "⑂";
  head.appendChild(icon);

  const title = document.createElement("span");
  title.className = "spawn-group-title";
  title.textContent = g.templateTitle;
  head.appendChild(title);

  head.appendChild(badge(`ctx-${g.context}`, g.context));

  const count = document.createElement("span");
  count.className = "spawn-count-pill";
  count.textContent = `${g.items.length} spawned`;
  head.appendChild(count);

  container.appendChild(head);

  g.items.forEach((s, i) => {
    container.appendChild(buildSpawnRow(s, i === g.items.length - 1));
  });

  return container;
}

function buildSpawnRow(s: Spawned, isLast: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = `spawn-row${s.is_done ? " is-done" : ""}`;

  const conn = document.createElement("span");
  conn.className = "spawn-conn";
  conn.textContent = isLast ? "└" : "├";
  row.appendChild(conn);

  const chkWrap = document.createElement("label");
  chkWrap.className = "chk-wrap";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.className = "chk chk-sm";
  chk.checked = s.is_done;
  chk.addEventListener("change", async () => {
    try {
      await invoke("toggle_spawned_done", { id: s.id, isDone: chk.checked });
      await loadSpawned();
    } catch (e) {
      chk.checked = !chk.checked;
      console.error("toggle_spawned_done:", e);
    }
  });
  chkWrap.appendChild(chk);
  row.appendChild(chkWrap);

  const stitle = document.createElement("span");
  stitle.className = "spawn-stitle";
  stitle.textContent = s.title;
  row.appendChild(stitle);

  const sdate = document.createElement("span");
  sdate.className = "spawn-sdate";
  sdate.textContent = formatShortDate(s.created_at);
  row.appendChild(sdate);

  const status = s.is_done ? "done" : s.due_date ? "scheduled" : "active";
  const pill = document.createElement("span");
  pill.className = `spawn-pill sp-${status}`;
  pill.textContent = status;
  row.appendChild(pill);

  return row;
}

// ─── Daily view ───────────────────────────────────────────

async function loadDaily() {
  let history: HistoryEntry[] = [];
  try {
    history = await invoke<HistoryEntry[]>("list_daily_history", { days: 126 });
  } catch (e) {
    console.error("list_daily_history:", e);
  }

  // Aggregate by date
  const dateMap = new Map<string, { done: number; total: number }>();
  for (const e of history) {
    const g = dateMap.get(e.date) ?? { done: 0, total: 0 };
    g.total++;
    if (e.is_done) g.done++;
    dateMap.set(e.date, g);
  }

  // Today stats (from live myDayInstances for accuracy)
  const done  = myDayInstances.filter(i => i.is_done).length;
  const total = myDayInstances.length;
  const rate  = total > 0 ? Math.round(done / total * 100) : 0;
  const streak = calcBestStreak(dateMap);

  const setEl = (id: string, v: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setEl("stat-today-done", total > 0 ? `${done}/${total}` : "—");
  setEl("stat-rate",       total > 0 ? `${rate}%` : "—");
  setEl("stat-streak",     streak > 0 ? `${streak}d` : "—");

  // Sync today into dateMap with live state
  const todayStr = isoDate(new Date());
  if (total > 0) dateMap.set(todayStr, { done, total });

  renderHeatmap(dateMap);
}

function renderHeatmap(dateMap: Map<string, { done: number; total: number }>) {
  const container = document.getElementById("heatmap")!;
  container.innerHTML = "";

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = isoDate(today);

  // Align start to 18 weeks ago, snapped to Sunday
  const start = new Date(today);
  start.setDate(start.getDate() - 18 * 7);
  start.setDate(start.getDate() - start.getDay());

  // Build week columns: each is an array of 7 days starting Sunday
  type Cell = { iso: string; lvl: number; isFuture: boolean; isToday: boolean };
  const weeks: Cell[][] = [];
  const cursor = new Date(start);

  while (
    cursor.getTime() <= today.getTime() ||
    (weeks.length > 0 && weeks[weeks.length - 1].length < 7)
  ) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([]);
    const iso = isoDate(cursor);
    const isFuture = cursor.getTime() > today.getTime();
    const isToday  = iso === todayStr;
    let lvl = 0;
    if (!isFuture) {
      const g = dateMap.get(iso);
      if (g) lvl = dateLevel(g.done, g.total);
    }
    weeks[weeks.length - 1].push({ iso, lvl, isFuture, isToday });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Month label row
  const monthRow = document.createElement("div");
  monthRow.className = "heat-month-row";
  let lastMonth = -1;
  for (const week of weeks) {
    const slot = document.createElement("span");
    slot.className = "heat-month-slot";
    const m = new Date(week[0].iso + "T00:00:00").getMonth();
    if (m !== lastMonth) { slot.textContent = MONTHS[m]; lastMonth = m; }
    monthRow.appendChild(slot);
  }

  // Heat body: day labels + week columns
  const body = document.createElement("div");
  body.className = "heat-body";

  const dayLabels = document.createElement("div");
  dayLabels.className = "heat-day-labels";
  ["", "Mon", "", "Wed", "", "Fri", ""].forEach(lbl => {
    const s = document.createElement("span");
    s.textContent = lbl;
    dayLabels.appendChild(s);
  });
  body.appendChild(dayLabels);

  const cols = document.createElement("div");
  cols.className = "heat-cols";
  for (const week of weeks) {
    const col = document.createElement("div");
    col.className = "heat-col";
    for (const day of week) {
      const cell = document.createElement("div");
      cell.className = `heat-cell${day.isToday ? " today" : ""}`;
      cell.dataset.lvl = String(day.lvl);
      if (day.isFuture) {
        cell.style.visibility = "hidden";
      } else {
        const g = dateMap.get(day.iso);
        cell.title = g
          ? `${day.iso} · ${g.done}/${g.total} done`
          : `${day.iso} · no data`;
      }
      col.appendChild(cell);
    }
    cols.appendChild(col);
  }
  body.appendChild(cols);

  container.appendChild(monthRow);
  container.appendChild(body);
}

// ─── Nav counts ───────────────────────────────────────────

async function updateNavCounts() {
  refreshMyDayPills();
  try {
    const [tasks, spawned] = await Promise.all([
      invoke<Task[]>("list_tasks", { filter: { status: "active" } }),
      invoke<Spawned[]>("list_spawned", {}),
    ]);
    document.getElementById("cnt-tasks")!.textContent   = tasks.length   > 0 ? String(tasks.length)   : "";
    document.getElementById("cnt-spawned")!.textContent = spawned.length > 0 ? String(spawned.length) : "";
  } catch (e) {
    console.error("updateNavCounts:", e);
  }
}

// ─── Modal ────────────────────────────────────────────────

function setChoice(group: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] .choice`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.v === value);
  });
}

function getChoice(group: string): string {
  return document.querySelector<HTMLButtonElement>(`[data-group="${group}"] .choice.active`)?.dataset.v ?? "";
}

function openCreateModal(defaultCategory: Category = "normal") {
  const card = document.getElementById("modal-card")!;
  card.dataset.mode = "create";
  document.getElementById("modal-title")!.textContent = "Create task";
  document.getElementById("modal-mode-tag")!.textContent = "CREATE";
  document.getElementById("modal-save")!.textContent = "Save";
  (document.getElementById("m-title")    as HTMLInputElement).value    = "";
  (document.getElementById("m-note")     as HTMLTextAreaElement).value = "";
  (document.getElementById("m-due")      as HTMLInputElement).value    = "";
  (document.getElementById("m-template") as HTMLInputElement).checked  = false;
  setChoice("context",  "personal");
  setChoice("category", defaultCategory);
  setChoice("status",   "active");
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  setTimeout(() => (document.getElementById("m-title") as HTMLInputElement).focus(), 50);
}

function openEditModal(t: Task) {
  editingTask = t;
  const card = document.getElementById("modal-card")!;
  card.dataset.mode = "edit";
  document.getElementById("modal-title")!.textContent = "Edit task";
  document.getElementById("modal-mode-tag")!.textContent = "EDIT";
  document.getElementById("modal-save")!.textContent = "Save";
  (document.getElementById("m-title") as HTMLInputElement).value    = t.title;
  (document.getElementById("m-note")  as HTMLTextAreaElement).value = t.note ?? "";
  (document.getElementById("m-due")   as HTMLInputElement).value    = t.due_date ?? "";
  setChoice("context",  t.context);
  setChoice("category", t.category);
  setChoice("status",   t.status);
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  setTimeout(() => (document.getElementById("m-title") as HTMLInputElement).focus(), 50);
}

async function openSpawnModal(preselectedId?: string) {
  try {
    // Backend only allows category=normal templates to be spawned
    spawnTemplates = await invoke<Task[]>("list_tasks", {
      filter: { is_template: true, status: "active", category: "normal" },
    });
  } catch {
    spawnTemplates = [];
  }

  if (spawnTemplates.length === 0) {
    // Fallback: open create modal suggesting template creation
    openCreateModal("normal");
    (document.getElementById("m-template") as HTMLInputElement).checked = true;
    return;
  }

  const select = document.getElementById("spawn-template-select") as HTMLSelectElement;
  select.innerHTML = "";
  for (const t of spawnTemplates) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title;
    select.appendChild(opt);
  }
  if (preselectedId) select.value = preselectedId;
  fillSpawnFields(select.value);

  const card = document.getElementById("modal-card")!;
  card.dataset.mode = "spawn";
  document.getElementById("modal-title")!.textContent = "Spawn instance";
  document.getElementById("modal-mode-tag")!.textContent = "SPAWN";
  document.getElementById("modal-save")!.textContent = "Spawn";
  (document.getElementById("m-note") as HTMLTextAreaElement).value = "";
  (document.getElementById("m-due")  as HTMLInputElement).value    = "";
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  setTimeout(() => (document.getElementById("m-title") as HTMLInputElement).focus(), 50);
}

function fillSpawnFields(templateId: string) {
  const t = spawnTemplates.find(t => t.id === templateId);
  if (!t) return;
  spawnFromTaskId = t.id;
  (document.getElementById("m-title") as HTMLInputElement).value = t.title;
  setChoice("context", t.context);
}

function closeModal() {
  document.getElementById("modal-scrim")!.classList.add("hidden");
  editingTask    = null;
  spawnFromTaskId = null;
}

async function saveModal() {
  const mode = document.getElementById("modal-card")!.dataset.mode as "create" | "edit" | "spawn";

  if (mode === "create") {
    const title = (document.getElementById("m-title") as HTMLInputElement).value.trim();
    if (!title) { (document.getElementById("m-title") as HTMLInputElement).focus(); return; }
    const context     = getChoice("context")  as Context;
    const category    = getChoice("category") as Category;
    const is_template = (document.getElementById("m-template") as HTMLInputElement).checked;
    const due         = (document.getElementById("m-due")      as HTMLInputElement).value;
    const note        = (document.getElementById("m-note")     as HTMLTextAreaElement).value.trim();
    try {
      await invoke("create_task", {
        input: { title, context, category, is_template, due_date: due || null, note: note || null },
      });
      if (category === "daily") await invoke("ensure_today_instances");
      closeModal();
      await loadMyDay();
      await updateNavCounts();
      if (currentView === "tasks") await loadTasks();
    } catch (e) { console.error("create_task:", e); }

  } else if (mode === "edit") {
    if (!editingTask) return;
    const title     = (document.getElementById("m-title") as HTMLInputElement).value.trim();
    if (!title) { (document.getElementById("m-title") as HTMLInputElement).focus(); return; }
    const context   = getChoice("context")  as Context;
    const newStatus = getChoice("status")   as Status;
    const due       = (document.getElementById("m-due")  as HTMLInputElement).value;
    const note      = (document.getElementById("m-note") as HTMLTextAreaElement).value.trim();
    try {
      await invoke("update_task", {
        input: { id: editingTask.id, title, context, due_date: due || null, note: note || null },
      });
      if (newStatus !== editingTask.status) {
        await invoke(newStatus === "archived" ? "archive_task" : "unarchive_task", { id: editingTask.id });
      }
      closeModal();
      await loadTasks();
      await loadMyDay();
      await updateNavCounts();
    } catch (e) { console.error("update_task:", e); }

  } else if (mode === "spawn") {
    if (!spawnFromTaskId) return;
    const title   = (document.getElementById("m-title") as HTMLInputElement).value.trim();
    const context = getChoice("context") as Context;
    const due     = (document.getElementById("m-due")  as HTMLInputElement).value;
    const note    = (document.getElementById("m-note") as HTMLTextAreaElement).value.trim();
    try {
      await invoke("spawn_task", {
        input: {
          template_id: spawnFromTaskId,
          title: title || null,
          context,
          due_date: due || null,
          note: note || null,
        },
      });
      closeModal();
      await loadSpawned();
      await updateNavCounts();
    } catch (e) { console.error("spawn_task:", e); }
  }
}

// ─── Reset banner ─────────────────────────────────────────

function showResetBanner() {
  const banner = document.getElementById("reset-banner")!;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 6000);
}

// ─── Init ─────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  // Theme
  const saved = localStorage.getItem(THEME_KEY) as "dark" | "light" | null;
  const sys   = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved ?? sys);

  // Today date subtitle
  document.getElementById("today-date-sub")!.textContent = formatDateLong();

  // Window controls
  try {
    const appWindow = getCurrentWindow();
    document.getElementById("win-min")!.addEventListener("click",   () => appWindow.minimize());
    document.getElementById("win-max")!.addEventListener("click",   () => appWindow.toggleMaximize());
    document.getElementById("win-close")!.addEventListener("click", () => appWindow.close());
  } catch { /* native decorations active */ }

  // Theme toggle
  document.getElementById("theme-btn")!.addEventListener("click", toggleTheme);

  // Sidebar navigation
  document.querySelectorAll<HTMLElement>(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const v = item.dataset.goto as ViewName;
      if (v) setView(v);
    });
  });

  // ── My Day ──
  document.querySelectorAll<HTMLButtonElement>(".chip[data-f]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip[data-f]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      myDayFilter = chip.dataset.f as typeof myDayFilter;
      renderMyDay();
    });
  });
  document.getElementById("new-task-btn")!.addEventListener("click", () => openCreateModal("daily"));

  // ── Tasks ──
  document.getElementById("task-search")!.addEventListener("input", e => {
    taskSearch = (e.target as HTMLInputElement).value;
    renderTasks();
  });
  document.querySelectorAll<HTMLButtonElement>("#task-filter .seg").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#task-filter .seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      taskFilter = btn.dataset.filter as typeof taskFilter;
      loadTasks();
    });
  });
  document.getElementById("new-task-tasks-btn")!.addEventListener("click", () => openCreateModal("normal"));

  // ── Spawned ──
  document.getElementById("spawn-template-btn")!.addEventListener("click", () => openSpawnModal());

  // ── Modal ──
  document.getElementById("modal-close")!.addEventListener("click",  closeModal);
  document.getElementById("modal-cancel")!.addEventListener("click", closeModal);
  document.getElementById("modal-save")!.addEventListener("click",   saveModal);
  document.getElementById("modal-scrim")!.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.querySelectorAll<HTMLButtonElement>(".choice").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest<HTMLElement>("[data-group]")?.dataset.group;
      if (group) setChoice(group, btn.dataset.v ?? "");
    });
  });

  // Spawn template select → fill fields
  document.getElementById("spawn-template-select")!.addEventListener("change", e => {
    fillSpawnFields((e.target as HTMLSelectElement).value);
  });

  // ── Reset banner ──
  document.getElementById("dismiss-reset")!.addEventListener("click", () => {
    document.getElementById("reset-banner")!.classList.add("hidden");
  });
  document.getElementById("sim-reset")!.addEventListener("click", async () => {
    try { await invoke("ensure_today_instances"); } catch {}
    await loadMyDay();
    showResetBanner();
  });

  // ── Keyboard shortcuts ──
  document.addEventListener("keydown", e => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    const inInput = tag === "input" || tag === "textarea" || tag === "select";

    if (e.key === "Escape") {
      if (!document.getElementById("modal-scrim")!.classList.contains("hidden")) closeModal();
      return;
    }
    if (inInput) return;

    if      (e.key === "1") setView("myday");
    else if (e.key === "2") setView("tasks");
    else if (e.key === "3") setView("spawned");
    else if (e.key === "4") setView("daily");
    else if (e.key === "n" || e.key === "N") {
      openCreateModal(currentView === "myday" ? "daily" : "normal");
    }
  });

  // ── Backend events ──
  listen("daily-reset", async () => {
    try { await invoke("ensure_today_instances"); } catch {}
    await loadMyDay();
    showResetBanner();
  });

  // ── Initial data load ──
  try { await invoke("ensure_today_instances"); } catch {}
  await loadMyDay();
  await updateNavCounts();
});
