import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "./markdown";

// ─── Types ────────────────────────────────────────────────

type Context  = "personal" | "work";
type Category = "daily" | "normal";
type Status   = "active" | "archived";
type ViewName = "myday" | "tasks" | "templates" | "daily";

interface Task {
  id: string;
  title: string;
  context: Context;
  category: Category;
  is_template: boolean;
  status: Status;
  due_date: string | null;
  note: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
}

interface TodayDaily {
  id: string;
  task_id: string;
  title: string;
  context: Context;
  is_template: boolean;
  template_note: string | null;
  instructions: string | null;
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
let currentMyDayDate: string = isoDate(new Date());
const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();

let taskFilter: "active" | "archived" = "active";
let taskSearch = "";
let tasksList: Task[] = [];

let editingTask: Task | null = null;
let templateList: Task[] = [];
let selectedTemplateId: string | null = null;

// ─── Helpers ──────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDateLong(d: Date = new Date()): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

function isViewingToday(): boolean {
  return currentMyDayDate === isoDate(new Date());
}

function updateMyDayDateNav() {
  const viewing = isViewingToday();
  document.getElementById("myday-prev-btn")!.style.display = viewing ? "" : "none";
  document.getElementById("myday-next-btn")!.style.display = viewing ? "none" : "";
  document.getElementById("today-date-sub")!.textContent = viewing
    ? formatDateLong()
    : "Yesterday — " + formatDateLong(new Date(currentMyDayDate + "T00:00:00"));
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

function hookExternalLinks(container: HTMLElement) {
  container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      const href = a.getAttribute("href");
      if (href) openUrl(href).catch(console.error);
    });
  });
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
  if (v === "tasks")     loadTasks();
  if (v === "templates") loadTemplates();
  if (v === "daily")     loadDaily();
}

// ─── My Day ───────────────────────────────────────────────

async function loadMyDay() {
  try {
    myDayInstances = isViewingToday()
      ? await invoke<TodayDaily[]>("list_today_daily")
      : await invoke<TodayDaily[]>("list_daily_for_date", { date: currentMyDayDate });
  } catch (e) {
    console.error("loadMyDay:", e);
    myDayInstances = [];
  }
  renderMyDay();
  refreshMyDayPills();
  updateMyDayDateNav();
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

  if (inst.instructions) {
    const instrBlock = document.createElement("div");
    instrBlock.className = "instructions-block";
    const instrLabel = document.createElement("span");
    instrLabel.className = "instructions-label";
    instrLabel.textContent = "Hướng dẫn";
    const instrText = document.createElement("p");
    instrText.className = "instructions-text";
    instrText.textContent = inst.instructions;
    instrBlock.appendChild(instrLabel);
    instrBlock.appendChild(instrText);
    body.appendChild(instrBlock);
  }

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

  const delBtn = document.createElement("button");
  delBtn.className = "instance-del-btn";
  delBtn.textContent = "×";
  delBtn.title = "Remove from today";
  delBtn.addEventListener("click", async () => {
    const msg = inst.kind === "daily"
      ? `Remove "${inst.title}" from today? (Will return tomorrow as a daily task.)`
      : `Remove "${inst.title}" from today? (Task still exists in your task list.)`;
    if (!window.confirm(msg)) return;
    try {
      await invoke("remove_from_today", { taskId: inst.task_id, date: currentMyDayDate, kind: inst.kind });
      document.getElementById(`row-${inst.id}`)?.remove();
      await updateNavCounts();
    } catch (e) { console.error("remove_from_today:", e); }
  });
  row.appendChild(delBtn);

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
  if (t.instructions) {
    const instrPreview = document.createElement("span");
    instrPreview.className = "task-instructions-preview";
    instrPreview.textContent = "▸ " + t.instructions.slice(0, 80);
    main.appendChild(instrPreview);
  }
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

// ─── Templates view ───────────────────────────────────────

async function loadTemplates() {
  let templates: Task[] = [];
  try {
    templates = await invoke<Task[]>("list_tasks", {
      filter: { is_template: true, status: "active" },
    });
  } catch (e) {
    console.error("list_tasks (templates):", e);
  }
  renderTemplates(templates);
  document.getElementById("cnt-templates")!.textContent = templates.length > 0 ? String(templates.length) : "";
}

function renderTemplates(templates: Task[]) {
  const list = document.getElementById("templates-list")!;
  list.innerHTML = "";

  if (templates.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.textContent = "No templates yet. Create a task and check “Is template” to save it here.";
    list.appendChild(el);
    return;
  }

  for (const t of templates) {
    list.appendChild(buildTemplateCard(t));
  }
}

function buildTemplateCard(t: Task): HTMLElement {
  const card = document.createElement("div");
  card.className = "template-card";

  const meta = document.createElement("div");
  meta.className = "template-card-meta";
  meta.appendChild(badge(`ctx-${t.context}`, t.context));
  if (t.category === "daily") meta.appendChild(badge("cat-daily", "daily"));
  card.appendChild(meta);

  const title = document.createElement("div");
  title.className = "template-card-title";
  title.textContent = t.title;
  card.appendChild(title);

  if (t.instructions) {
    const instrBlock = document.createElement("div");
    instrBlock.className = "instructions-block";
    const instrLabel = document.createElement("span");
    instrLabel.className = "instructions-label";
    instrLabel.textContent = "Hướng dẫn";
    const instrContent = document.createElement("div");
    instrContent.className = "instructions-text md-content";
    instrContent.innerHTML = renderMarkdown(t.instructions);
    hookExternalLinks(instrContent);
    instrBlock.appendChild(instrLabel);
    instrBlock.appendChild(instrContent);
    card.appendChild(instrBlock);
  }

  if (t.note) {
    const noteWrap = document.createElement("div");
    noteWrap.className = "template-card-note md-content";
    noteWrap.innerHTML = renderMarkdown(t.note);
    hookExternalLinks(noteWrap);
    card.appendChild(noteWrap);

    // Expand/collapse toggle — shown only if content overflows
    const toggle = document.createElement("button");
    toggle.className = "note-toggle-btn";
    toggle.textContent = "show more";
    toggle.style.display = "none";
    toggle.addEventListener("click", () => {
      const expanded = noteWrap.classList.toggle("expanded");
      toggle.textContent = expanded ? "show less" : "show more";
    });
    card.appendChild(toggle);

    // After paint: check if content overflows the collapsed max-height
    requestAnimationFrame(() => {
      if (noteWrap.scrollHeight > noteWrap.clientHeight) {
        toggle.style.display = "block";
      }
    });
  }

  const actions = document.createElement("div");
  actions.className = "template-card-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn ghost template-edit-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditModal(t));
  actions.appendChild(editBtn);

  const useBtn = document.createElement("button");
  useBtn.className = "btn ghost template-use-btn";
  useBtn.textContent = "⑂ Use today";
  useBtn.addEventListener("click", () => openUseTemplateModal(t.id));
  actions.appendChild(useBtn);

  card.appendChild(actions);
  return card;
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
    const [tasks, templates] = await Promise.all([
      invoke<Task[]>("list_tasks", { filter: { status: "active" } }),
      invoke<Task[]>("list_tasks", { filter: { is_template: true, status: "active" } }),
    ]);
    document.getElementById("cnt-tasks")!.textContent     = tasks.length     > 0 ? String(tasks.length)     : "";
    document.getElementById("cnt-templates")!.textContent = templates.length > 0 ? String(templates.length) : "";
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

function syncDueDateUI() {
  const card = document.getElementById("modal-card") as HTMLElement;
  const mode = card.dataset.mode;
  if (mode !== "create" && mode !== "edit") return;
  const wrapper = document.getElementById("due-wrapper")!;
  const dueInput = document.getElementById("m-due") as HTMLInputElement;
  const category = getChoice("category");
  if (category === "daily") {
    wrapper.style.display = "none";
    dueInput.value = "";
  } else {
    wrapper.style.display = "flex";
    if (mode === "create") {
      const dueMode = getChoice("due-mode");
      if (dueMode === "today") {
        dueInput.value = isoDate(new Date());
        dueInput.style.display = "none";
      } else {
        dueInput.style.display = "";
      }
    } else {
      dueInput.style.display = "";
    }
  }
}

function openCreateModal(defaultCategory: Category = "normal") {
  const card = document.getElementById("modal-card")!;
  card.dataset.mode = "create";
  document.getElementById("modal-title")!.textContent = "Create task";
  document.getElementById("modal-mode-tag")!.textContent = "CREATE";
  document.getElementById("modal-save")!.textContent = "Save";
  (document.getElementById("m-title")        as HTMLInputElement).value    = "";
  (document.getElementById("m-instructions") as HTMLTextAreaElement).value = "";
  (document.getElementById("m-note")         as HTMLTextAreaElement).value = "";
  (document.getElementById("m-template")     as HTMLInputElement).checked  = false;
  setChoice("context",  "personal");
  setChoice("category", defaultCategory);
  setChoice("due-mode", "today");
  setChoice("status",   "active");
  syncDueDateUI();
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  const noteEl = document.getElementById("m-note") as HTMLTextAreaElement;
  setTimeout(() => { (document.getElementById("m-title") as HTMLInputElement).focus(); autoResize(noteEl); }, 50);
}

function openEditModal(t: Task) {
  editingTask = t;
  const card = document.getElementById("modal-card")!;
  card.dataset.mode = "edit";
  document.getElementById("modal-title")!.textContent = "Edit task";
  document.getElementById("modal-mode-tag")!.textContent = "EDIT";
  document.getElementById("modal-save")!.textContent = "Save";
  (document.getElementById("m-title")        as HTMLInputElement).value    = t.title;
  (document.getElementById("m-instructions") as HTMLTextAreaElement).value = t.instructions ?? "";
  (document.getElementById("m-note")         as HTMLTextAreaElement).value = t.note ?? "";
  (document.getElementById("m-template")     as HTMLInputElement).checked  = t.is_template ?? false;
  (document.getElementById("m-due")      as HTMLInputElement).value    = t.due_date ?? "";
  setChoice("context",  t.context);
  setChoice("category", t.category);
  setChoice("status",   t.status);
  syncDueDateUI();
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  const noteEl2 = document.getElementById("m-note") as HTMLTextAreaElement;
  setTimeout(() => { (document.getElementById("m-title") as HTMLInputElement).focus(); autoResize(noteEl2); }, 50);
}

async function openUseTemplateModal(preselectedId?: string) {
  try {
    templateList = await invoke<Task[]>("list_tasks", {
      filter: { is_template: true, status: "active" },
    });
  } catch {
    templateList = [];
  }

  if (templateList.length === 0) {
    openCreateModal("normal");
    (document.getElementById("m-template") as HTMLInputElement).checked = true;
    return;
  }

  const select = document.getElementById("spawn-template-select") as HTMLSelectElement;
  select.innerHTML = "";
  for (const t of templateList) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title;
    select.appendChild(opt);
  }
  if (preselectedId) select.value = preselectedId;

  const card = document.getElementById("modal-card")!;
  card.dataset.mode = "spawn";
  document.getElementById("modal-title")!.textContent = "Use template today";
  document.getElementById("modal-mode-tag")!.textContent = "USE";
  document.getElementById("modal-save")!.textContent = "Add to My Day";
  (document.getElementById("m-instructions") as HTMLTextAreaElement).value = "";
  (document.getElementById("m-note")         as HTMLTextAreaElement).value = "";
  (document.getElementById("m-due")          as HTMLInputElement).value    = isoDate(new Date());
  fillTemplateFields(select.value);
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  setTimeout(() => (document.getElementById("m-title") as HTMLInputElement).focus(), 50);
}

function fillTemplateFields(templateId: string) {
  const t = templateList.find(t => t.id === templateId);
  if (!t) return;
  selectedTemplateId = t.id;
  (document.getElementById("m-title")        as HTMLInputElement).value    = t.title;
  (document.getElementById("m-instructions") as HTMLTextAreaElement).value = t.instructions ?? "";
  setChoice("context", t.context);
}

function closeModal() {
  document.getElementById("modal-scrim")!.classList.add("hidden");
  editingTask        = null;
  selectedTemplateId = null;
}

async function saveModal() {
  const mode = document.getElementById("modal-card")!.dataset.mode as "create" | "edit" | "spawn";

  if (mode === "create") {
    const title = (document.getElementById("m-title") as HTMLInputElement).value.trim();
    if (!title) { (document.getElementById("m-title") as HTMLInputElement).focus(); return; }
    const context      = getChoice("context")  as Context;
    const category     = getChoice("category") as Category;
    const is_template  = (document.getElementById("m-template")     as HTMLInputElement).checked;
    const due          = (document.getElementById("m-due")           as HTMLInputElement).value;
    const instructions = (document.getElementById("m-instructions")  as HTMLTextAreaElement).value.trim();
    const note         = (document.getElementById("m-note")          as HTMLTextAreaElement).value.trim();
    try {
      await invoke("create_task", {
        input: { title, context, category, is_template, due_date: due || null, instructions: instructions || null, note: note || null },
      });
      if (category === "daily") await invoke("ensure_today_instances");
      closeModal();
      await loadMyDay();
      await updateNavCounts();
      if (currentView === "tasks") await loadTasks();
    } catch (e) { console.error("create_task:", e); }

  } else if (mode === "edit") {
    if (!editingTask) return;
    const title        = (document.getElementById("m-title") as HTMLInputElement).value.trim();
    if (!title) { (document.getElementById("m-title") as HTMLInputElement).focus(); return; }
    const context      = getChoice("context")   as Context;
    const category     = getChoice("category")  as Category;
    const newStatus    = getChoice("status")    as Status;
    const isTemplate   = (document.getElementById("m-template")     as HTMLInputElement).checked;
    const due          = (document.getElementById("m-due")           as HTMLInputElement).value;
    const instructions = (document.getElementById("m-instructions")  as HTMLTextAreaElement).value.trim();
    const note         = (document.getElementById("m-note")          as HTMLTextAreaElement).value.trim();
    try {
      await invoke("update_task", {
        input: { id: editingTask.id, title, context, category, is_template: isTemplate, due_date: due || null, instructions: instructions || null, note: note || null },
      });
      if (newStatus !== editingTask.status) {
        await invoke(newStatus === "archived" ? "archive_task" : "unarchive_task", { id: editingTask.id });
      }
      if (category === "daily") {
        try { await invoke("ensure_today_instances"); } catch {}
      }
      closeModal();
      if (currentView === "templates") await loadTemplates();
      await loadTasks();
      await loadMyDay();
      await updateNavCounts();
    } catch (e) { console.error("update_task:", e); }

  } else if (mode === "spawn") {
    if (!selectedTemplateId) return;
    const tmpl = templateList.find(t => t.id === selectedTemplateId);
    if (!tmpl) return;
    const title        = (document.getElementById("m-title")        as HTMLInputElement).value.trim() || tmpl.title;
    const context      = getChoice("context") as Context;
    const due          = (document.getElementById("m-due")          as HTMLInputElement).value || isoDate(new Date());
    const instructions = (document.getElementById("m-instructions") as HTMLTextAreaElement).value.trim();
    const note         = (document.getElementById("m-note")         as HTMLTextAreaElement).value.trim();
    try {
      await invoke("create_task", {
        input: {
          title,
          context,
          category: "normal" as Category,
          is_template: false,
          due_date: due,
          instructions: instructions || null,
          note: note || null,
        },
      });
      closeModal();
      setView("myday");
      await loadMyDay();
      await updateNavCounts();
    } catch (e) { console.error("use_template:", e); }
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

  // Today date subtitle + yesterday nav
  updateMyDayDateNav();
  document.getElementById("myday-prev-btn")!.addEventListener("click", async () => {
    currentMyDayDate = yesterdayIso();
    await loadMyDay();
  });
  document.getElementById("myday-next-btn")!.addEventListener("click", async () => {
    currentMyDayDate = isoDate(new Date());
    await loadMyDay();
  });

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

  // ── From template (My Day) ──
  document.getElementById("from-template-btn")!.addEventListener("click", () => openUseTemplateModal());

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
      if (group) {
        setChoice(group, btn.dataset.v ?? "");
        if (group === "category" || group === "due-mode") syncDueDateUI();
      }
    });
  });

  // Note textarea → auto-resize
  const modalNote = document.getElementById("m-note") as HTMLTextAreaElement;
  modalNote.addEventListener("input", () => autoResize(modalNote));

  // Template select in modal → fill fields
  document.getElementById("spawn-template-select")!.addEventListener("change", e => {
    fillTemplateFields((e.target as HTMLSelectElement).value);
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
    else if (e.key === "3") setView("templates");
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
