import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderMarkdown } from "./markdown";

type Context = "personal" | "work";
type Category = "daily" | "normal";
type Status = "active" | "archived";

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

interface TaskFilter {
  context?: Context;
  category?: Category;
  is_template?: boolean;
  status?: Status;
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
}

// ---- Theme ----
const ThemeManager = (() => {
  const KEY = "taska-theme";
  const html = document.documentElement;

  function apply(theme: "dark" | "light") {
    html.classList.add("theme-transitioning");
    html.dataset.theme = theme;
    const btn = document.getElementById("theme-toggle") as HTMLButtonElement | null;
    if (btn) {
      const isLight = theme === "light";
      btn.setAttribute("aria-checked", isLight ? "true" : "false");
      const lbl = btn.querySelector<HTMLElement>(".toggle-label");
      if (lbl) lbl.textContent = isLight ? "Light" : "Dark";
    }
    setTimeout(() => html.classList.remove("theme-transitioning"), 250);
  }

  function init() {
    const saved = localStorage.getItem(KEY) as "dark" | "light" | null;
    const sys = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    apply(saved ?? sys);
  }

  function toggle() {
    const next = html.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem(KEY, next);
    apply(next);
  }

  return { init, toggle };
})();
ThemeManager.init();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

function showError(msg: string | null) {
  const el = $("#err");
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = msg;
}

function dueClass(due: string | null): string {
  if (!due) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff <= 1) return "danger";
  if (diff <= 3) return "warn";
  return "ok";
}

function dueLabel(due: string, cls: string): string {
  if (cls === "overdue") return `${due} · overdue`;
  if (cls === "danger")  return `${due} · ≤1d`;
  if (cls === "warn")    return `${due} · ≤3d`;
  return due;
}

function badge(text: string, cls: string): HTMLElement {
  const b = document.createElement("span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function renderTask(t: Task): HTMLElement {
  const el = document.createElement("div");
  el.className = "task";

  const head = document.createElement("div");
  head.className = "task-head";

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = t.title;
  head.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  if (t.is_template && t.category === "normal" && t.status === "active") {
    const spawnBtn = document.createElement("button");
    spawnBtn.className = "primary";
    spawnBtn.textContent = "Spawn";
    spawnBtn.onclick = () => openSpawn(t);
    actions.appendChild(spawnBtn);
  }

  const editBtn = document.createElement("button");
  editBtn.className = "ghost";
  editBtn.textContent = "Edit";
  editBtn.onclick = () => openEdit(t);
  actions.appendChild(editBtn);

  const archBtn = document.createElement("button");
  archBtn.className = "danger";
  archBtn.textContent = t.status === "archived" ? "Unarchive" : "Archive";
  archBtn.onclick = async () => {
    try {
      await invoke(t.status === "archived" ? "unarchive_task" : "archive_task", { id: t.id });
      await refresh();
    } catch (e) { showError(String(e)); }
  };
  actions.appendChild(archBtn);

  head.appendChild(actions);
  el.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.appendChild(badge(t.context, t.context));
  meta.appendChild(badge(t.category, t.category));
  if (t.is_template) meta.appendChild(badge("template", "template"));
  if (t.status === "archived") meta.appendChild(badge("archived", "archived"));
  if (t.due_date) {
    const cls = dueClass(t.due_date);
    const due = document.createElement("span");
    due.className = `due ${cls}`;
    due.textContent = dueLabel(t.due_date, cls);
    meta.appendChild(due);
  }
  el.appendChild(meta);

  if (t.note) {
    const note = document.createElement("div");
    note.className = "task-note md";
    note.innerHTML = renderMarkdown(t.note);
    el.appendChild(note);
  }

  return el;
}

let editingId: string | null = null;

function openEdit(t: Task) {
  editingId = t.id;
  ($("#e-title")  as HTMLInputElement).value    = t.title;
  ($("#e-context") as HTMLSelectElement).value  = t.context;
  ($("#e-due")    as HTMLInputElement).value    = t.due_date ?? "";
  ($("#e-note")   as HTMLTextAreaElement).value = t.note ?? "";
  $("#edit-modal").hidden = false;
  ($("#e-title") as HTMLInputElement).focus();
}

function closeEdit() {
  editingId = null;
  $("#edit-modal").hidden = true;
}

async function submitEdit(e: Event) {
  e.preventDefault();
  if (!editingId) return;
  const title   = ($("#e-title")  as HTMLInputElement).value.trim();
  const context = ($("#e-context") as HTMLSelectElement).value as Context;
  const due     = ($("#e-due")    as HTMLInputElement).value;
  const note    = ($("#e-note")   as HTMLTextAreaElement).value;
  try {
    await invoke("update_task", {
      input: {
        id: editingId,
        title,
        context,
        due_date: due ? due : null,
        note: note.trim() ? note : null,
      },
    });
    closeEdit();
    showError(null);
    await Promise.all([refresh(), refreshToday(), refreshSpawned()]);
  } catch (err) { showError(String(err)); }
}

// ---------- Daily history ----------

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dateRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

let histView: "heatmap" | "calendar" = "heatmap";
// Calendar current focus: { year, month1-12 }
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;

async function refreshHistory() {
  const body = $("#hist-body");
  if (body.hidden) return;
  if (histView === "heatmap") await renderHeatmap();
  else await renderCalendar();
}

async function renderHeatmap() {
  const days = parseInt(($("#hist-days") as HTMLSelectElement).value, 10) || 30;
  let entries: HistoryEntry[];
  try {
    entries = await invoke<HistoryEntry[]>("list_daily_history", { days });
  } catch (e) { showError(String(e)); return; }

  const grid = $("#hist-grid");
  const empty = $("#hist-empty");
  grid.innerHTML = "";

  // Map (task_id|date) -> entry
  const byKey = new Map<string, HistoryEntry>();
  const tasksMap = new Map<string, { id: string; title: string; context: Context; status: Status }>();
  for (const e of entries) {
    byKey.set(`${e.task_id}|${e.date}`, e);
    if (!tasksMap.has(e.task_id)) {
      tasksMap.set(e.task_id, {
        id: e.task_id, title: e.task_title, context: e.context, status: e.task_status,
      });
    }
  }

  if (tasksMap.size === 0) {
    grid.hidden = true; empty.hidden = false; return;
  }
  grid.hidden = false; empty.hidden = true;

  const tasks = Array.from(tasksMap.values()).sort((a, b) => {
    if (a.context !== b.context) return a.context.localeCompare(b.context);
    return a.title.localeCompare(b.title);
  });
  const dates = dateRange(days);
  const todayStr = dates[dates.length - 1];

  const COL_W = 28, NAME_W = 200, GAP = 2;
  grid.style.gridTemplateColumns = `${NAME_W}px repeat(${dates.length}, ${COL_W}px)`;
  grid.style.width = `${NAME_W + dates.length * (COL_W + GAP)}px`;

  // Header row
  const corner = document.createElement("div");
  corner.className = "hist-cell head-corner head-col";
  corner.textContent = "Task";
  grid.appendChild(corner);
  for (const d of dates) {
    const cell = document.createElement("div");
    cell.className = "hist-cell head-col" + (d === todayStr ? " today" : "");
    const [_, mon, day] = d.split("-");
    const num = document.createElement("span"); num.className = "day-num"; num.textContent = day;
    const mn  = document.createElement("span"); mn.className  = "day-mon"; mn.textContent  = MONTHS[parseInt(mon, 10) - 1];
    cell.appendChild(num); cell.appendChild(mn);
    cell.title = d;
    grid.appendChild(cell);
  }

  // Stats per task
  let totalDone = 0, totalSlots = 0;

  for (const t of tasks) {
    const head = document.createElement("div");
    head.className = "hist-cell head-row";
    head.textContent = t.title;
    if (t.status === "archived") head.classList.add("archived-row");
    head.title = `${t.context} · ${t.status}`;
    grid.appendChild(head);

    for (const d of dates) {
      const entry = byKey.get(`${t.id}|${d}`);
      const cell = document.createElement("div");
      cell.className = "hist-cell";
      if (d === todayStr) cell.classList.add("today-col");
      const mark = document.createElement("span"); mark.className = "mark";
      if (!entry) {
        cell.classList.add("none");
        mark.textContent = "·";
      } else {
        cell.classList.add(entry.is_done ? "done" : "miss");
        cell.classList.add("cell-clickable");
        mark.textContent = entry.is_done ? "✓" : "✗";
        if (entry.note) cell.classList.add("has-note");
        cell.title = `${d} · ${entry.is_done ? "done" : "not done"}${entry.note ? "\n" + entry.note : ""}`;
        cell.onclick = () =>
          openHistModal(`${t.title} · ${d}`, [{ entry, taskTitle: t.title }]);
        if (entry.is_done) totalDone++;
        totalSlots++;
      }
      cell.appendChild(mark);
      grid.appendChild(cell);
    }
  }

  // Stats line
  let stats = document.querySelector<HTMLDivElement>("#hist-stats");
  if (!stats) {
    stats = document.createElement("div");
    stats.id = "hist-stats";
    stats.className = "hist-stats";
    $("#hist-view-heatmap").appendChild(stats);
  }
  const pct = totalSlots > 0 ? Math.round((totalDone / totalSlots) * 100) : 0;
  stats.innerHTML = "";
  const s1 = document.createElement("span");
  s1.innerHTML = `range: <b>${dates[0]}</b> → <b>${dates[dates.length - 1]}</b>`;
  const s2 = document.createElement("span");
  s2.innerHTML = `done: <b>${totalDone} / ${totalSlots}</b> (${pct}%)`;
  const s3 = document.createElement("span");
  s3.innerHTML = `tasks: <b>${tasks.length}</b>`;
  stats.appendChild(s1); stats.appendChild(s2); stats.appendChild(s3);
}

// ---------- Calendar view ----------

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function calIntensityClass(ratio: number): string {
  if (ratio <= 0) return "s0";
  if (ratio < 0.25) return "s1";
  if (ratio < 0.5)  return "s2";
  if (ratio < 0.85) return "s3";
  return "s4";
}

async function renderCalendar() {
  const grid = $("#cal-grid");
  $("#cal-month-label").textContent = `${MONTH_NAMES[calMonth - 1]} ${calYear}`;

  const firstOfMonth = new Date(calYear, calMonth - 1, 1);
  const lastOfMonth  = new Date(calYear, calMonth, 0);
  // ISO Mon=0..Sun=6
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = lastOfMonth.getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  const from = `${calYear}-${pad2(calMonth)}-01`;
  const to   = `${calYear}-${pad2(calMonth)}-${pad2(daysInMonth)}`;

  let entries: HistoryEntry[];
  try {
    entries = await invoke<HistoryEntry[]>("list_daily_history_between", { from, to });
  } catch (e) { showError(String(e)); return; }

  // Group by date
  const byDate = new Map<string, { entries: HistoryEntry[]; titles: Map<string, string> }>();
  for (const e of entries) {
    let g = byDate.get(e.date);
    if (!g) { g = { entries: [], titles: new Map() }; byDate.set(e.date, g); }
    g.entries.push(e);
    g.titles.set(e.task_id, e.task_title);
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  grid.innerHTML = "";
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startDow + 1;
    const cell = document.createElement("div");
    cell.className = "cal-cell";

    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add("muted");
      grid.appendChild(cell);
      continue;
    }

    const dateStr = `${calYear}-${pad2(calMonth)}-${pad2(dayNum)}`;
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;
    if (isToday) cell.classList.add("today");
    if (isFuture) cell.classList.add("future", "muted");

    const dayLabel = document.createElement("span");
    dayLabel.className = "cal-day" + (isToday ? " today" : "");
    dayLabel.textContent = String(dayNum);
    cell.appendChild(dayLabel);

    const grp = byDate.get(dateStr);
    if (grp && grp.entries.length > 0) {
      const done = grp.entries.filter(e => e.is_done).length;
      const total = grp.entries.length;
      const ratio = total > 0 ? done / total : 0;
      cell.classList.add(calIntensityClass(ratio));

      const ratioEl = document.createElement("span");
      ratioEl.className = "cal-ratio";
      ratioEl.textContent = `${done}/${total}`;
      cell.appendChild(ratioEl);

      const bar = document.createElement("div");
      bar.className = "cal-bar";
      const fill = document.createElement("div");
      fill.className = "cal-bar-fill";
      fill.style.width = `${Math.round(ratio * 100)}%`;
      bar.appendChild(fill);
      cell.appendChild(bar);

      cell.classList.add("clickable");
      cell.onclick = () => {
        const items = grp.entries.map(e => ({
          entry: e,
          taskTitle: grp.titles.get(e.task_id) ?? e.task_title,
        }));
        openHistModal(dateStr, items);
      };
    } else if (!isFuture) {
      const dash = document.createElement("span");
      dash.className = "cal-ratio";
      dash.textContent = "—";
      cell.appendChild(dash);
    }

    grid.appendChild(cell);
  }
}

function calNav(delta: number) {
  calMonth += delta;
  if (calMonth > 12) { calMonth = 1; calYear++; }
  if (calMonth < 1)  { calMonth = 12; calYear--; }
  refreshHistory();
}

function calGoToday() {
  const n = new Date();
  calYear = n.getFullYear();
  calMonth = n.getMonth() + 1;
  refreshHistory();
}

function setHistView(view: "heatmap" | "calendar") {
  histView = view;
  document.querySelectorAll<HTMLButtonElement>(".tabs .tab").forEach(t => {
    t.classList.toggle("active", t.dataset.view === view);
  });
  $("#hist-view-heatmap").hidden  = view !== "heatmap";
  $("#hist-view-calendar").hidden = view !== "calendar";
  $("#hist-days").hidden = view !== "heatmap";
  refreshHistory();
}

// ---------- History modal ----------

interface ModalItem {
  entry: HistoryEntry;
  taskTitle: string;
  origDone: boolean;
  origNote: string;
}
let modalItems: ModalItem[] = [];

function openHistModal(title: string, items: { entry: HistoryEntry; taskTitle: string }[]) {
  modalItems = items.map(i => ({
    entry: i.entry,
    taskTitle: i.taskTitle,
    origDone: i.entry.is_done,
    origNote: i.entry.note ?? "",
  }));
  $("#hm-title").textContent = title;

  const body = $("#hm-body");
  body.innerHTML = "";
  if (modalItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hm-empty";
    empty.textContent = "No daily instances on this day.";
    body.appendChild(empty);
  } else {
    modalItems.forEach((mi, idx) => {
      const row = document.createElement("div");
      row.className = "hm-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = mi.entry.is_done;
      cb.dataset.idx = String(idx);
      cb.addEventListener("change", () => {
        modalItems[idx].entry.is_done = cb.checked;
        titleEl.classList.toggle("done", cb.checked);
      });
      row.appendChild(cb);

      const info = document.createElement("div");
      info.className = "hm-info";
      const line = document.createElement("div");
      line.className = "hm-title-line";
      const titleEl = document.createElement("span");
      titleEl.className = "hm-task-title" + (mi.entry.is_done ? " done" : "");
      titleEl.textContent = mi.taskTitle;
      line.appendChild(titleEl);
      line.appendChild(badge(mi.entry.context, mi.entry.context));
      info.appendChild(line);

      const noteInput = document.createElement("input");
      noteInput.className = "hm-note-input";
      noteInput.placeholder = "note (optional)";
      noteInput.value = mi.entry.note ?? "";
      noteInput.addEventListener("input", () => {
        modalItems[idx].entry.note = noteInput.value;
      });
      info.appendChild(noteInput);

      row.appendChild(info);
      body.appendChild(row);
    });
  }

  $("#hist-modal").hidden = false;
}

function closeHistModal() {
  modalItems = [];
  $("#hist-modal").hidden = true;
}

async function saveHistModal() {
  const ops: Promise<unknown>[] = [];
  for (const mi of modalItems) {
    if (mi.entry.is_done !== mi.origDone) {
      ops.push(invoke("toggle_daily_done", { id: mi.entry.id, isDone: mi.entry.is_done }));
    }
    const newNote = (mi.entry.note ?? "").trim();
    if (newNote !== mi.origNote.trim()) {
      ops.push(invoke("set_daily_note", {
        id: mi.entry.id,
        note: newNote ? newNote : null,
      }));
    }
  }
  if (ops.length === 0) { closeHistModal(); return; }
  try {
    await Promise.all(ops);
    closeHistModal();
    showError(null);
    await Promise.all([refreshToday(), refreshHistory()]);
  } catch (e) { showError(String(e)); }
}

// ---------- Spawn from template ----------

let spawningFrom: Task | null = null;

function openSpawn(t: Task) {
  spawningFrom = t;
  ($("#sp-title")   as HTMLInputElement).value = t.title;
  ($("#sp-context") as HTMLSelectElement).value = t.context;
  ($("#sp-due")     as HTMLInputElement).value = "";
  ($("#sp-note")    as HTMLTextAreaElement).value = "";
  const from = $("#spawn-from");
  from.innerHTML = "";
  from.append("from template ");
  const b = document.createElement("b");
  b.textContent = t.title;
  from.appendChild(b);
  $("#spawn-modal").hidden = false;
  ($("#sp-title") as HTMLInputElement).select();
}

function closeSpawn() {
  spawningFrom = null;
  $("#spawn-modal").hidden = true;
}

async function submitSpawn(e: Event) {
  e.preventDefault();
  if (!spawningFrom) return;
  const title   = ($("#sp-title")   as HTMLInputElement).value.trim();
  const context = ($("#sp-context") as HTMLSelectElement).value as Context;
  const due     = ($("#sp-due")     as HTMLInputElement).value;
  const note    = ($("#sp-note")    as HTMLTextAreaElement).value;
  try {
    await invoke("spawn_task", {
      input: {
        template_id: spawningFrom.id,
        title: title || null,
        context,
        due_date: due || null,
        note: note.trim() ? note : null,
      },
    });
    closeSpawn();
    showError(null);
    await refreshSpawned();
  } catch (err) { showError(String(err)); }
}

function renderSpawned(s: Spawned): HTMLElement {
  const el = document.createElement("div");
  el.className = "spawned" + (s.is_done ? " done" : "");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "spawned-check";
  cb.checked = s.is_done;
  cb.onchange = async () => {
    try {
      await invoke("toggle_spawned_done", { id: s.id, isDone: cb.checked });
      await refreshSpawned();
    } catch (e) { showError(String(e)); cb.checked = !cb.checked; }
  };
  el.appendChild(cb);

  const body = document.createElement("div");
  body.className = "spawned-body";

  const head = document.createElement("div");
  head.className = "spawned-head";
  const left = document.createElement("div");
  left.className = "spawned-head-left";
  const title = document.createElement("span");
  title.className = "spawned-title";
  title.textContent = s.title;
  left.appendChild(title);
  left.appendChild(badge(s.context, s.context));
  if (s.due_date) {
    const cls = dueClass(s.due_date);
    const due = document.createElement("span");
    due.className = `due ${cls}`;
    due.textContent = dueLabel(s.due_date, cls);
    left.appendChild(due);
  }
  head.appendChild(left);

  const acts = document.createElement("div");
  acts.className = "spawned-actions";
  let tmplBox: HTMLElement | null = null;
  if (s.template_note) {
    const tmplBtn = document.createElement("button");
    tmplBtn.className = "ghost";
    tmplBtn.textContent = "▸ steps";
    tmplBtn.onclick = () => {
      if (!tmplBox) return;
      const open = !tmplBox.hidden;
      tmplBox.hidden = open;
      tmplBtn.textContent = open ? "▸ steps" : "▾ steps";
    };
    acts.appendChild(tmplBtn);
  }
  const delBtn = document.createElement("button");
  delBtn.className = "danger";
  delBtn.textContent = "Delete";
  delBtn.onclick = async () => {
    if (!confirm(`Delete spawned task "${s.title}"?`)) return;
    try {
      await invoke("delete_spawned", { id: s.id });
      await refreshSpawned();
    } catch (e) { showError(String(e)); }
  };
  acts.appendChild(delBtn);
  head.appendChild(acts);
  body.appendChild(head);

  if (s.note) {
    const noteEl = document.createElement("div");
    noteEl.className = "spawned-note md";
    noteEl.innerHTML = renderMarkdown(s.note);
    body.appendChild(noteEl);
  }

  if (s.template_note) {
    tmplBox = document.createElement("div");
    tmplBox.className = "spawned-tmpl-box";
    tmplBox.hidden = true;
    const from = document.createElement("div");
    from.className = "tmpl-from";
    from.textContent = `from template: ${s.template_title}`;
    tmplBox.appendChild(from);
    const md = document.createElement("div");
    md.className = "md";
    md.innerHTML = renderMarkdown(s.template_note);
    tmplBox.appendChild(md);
    body.appendChild(tmplBox);
  }

  el.appendChild(body);
  return el;
}

async function refreshSpawned() {
  try {
    const includeDone = ($("#sp-include-done") as HTMLInputElement).checked;
    const items = await invoke<Spawned[]>("list_spawned", { includeDone });
    const list = $("#spawned-list");
    list.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = includeDone
        ? "No spawned tasks yet."
        : "Nothing in progress. Spawn from a template below.";
      list.appendChild(empty);
    } else {
      items.forEach(s => list.appendChild(renderSpawned(s)));
    }
    showError(null);
  } catch (e) { showError(String(e)); }
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let h: number | undefined;
  return ((...args: any[]) => {
    if (h) clearTimeout(h);
    h = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

function renderDaily(d: TodayDaily): HTMLElement {
  const el = document.createElement("div");
  el.className = "daily" + (d.is_done ? " done" : "");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "daily-check";
  cb.checked = d.is_done;
  cb.onchange = async () => {
    try {
      await invoke("toggle_daily_done", { id: d.id, isDone: cb.checked });
      el.classList.toggle("done", cb.checked);
      d.is_done = cb.checked;
      refreshHistory();
    } catch (e) { showError(String(e)); cb.checked = !cb.checked; }
  };
  el.appendChild(cb);

  const body = document.createElement("div");
  body.className = "daily-body";

  const line = document.createElement("div");
  line.className = "daily-line";
  const title = document.createElement("span");
  title.className = "daily-title";
  title.textContent = d.title;
  line.appendChild(title);
  line.appendChild(badge(d.context, d.context));
  if (d.is_template) line.appendChild(badge("template", "template"));

  let tmplEl: HTMLElement | null = null;
  if (d.template_note) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tmpl-toggle";
    toggle.textContent = "▸ steps";
    toggle.onclick = () => {
      if (!tmplEl) return;
      const open = !tmplEl.hidden;
      tmplEl.hidden = open;
      toggle.textContent = open ? "▸ steps" : "▾ steps";
    };
    line.appendChild(toggle);
  }
  body.appendChild(line);

  if (d.template_note) {
    tmplEl = document.createElement("div");
    tmplEl.className = "daily-tmpl md";
    tmplEl.hidden = true;
    tmplEl.innerHTML = renderMarkdown(d.template_note);
    body.appendChild(tmplEl);
  }

  const noteInput = document.createElement("input");
  noteInput.className = "daily-note-input";
  noteInput.placeholder = "+ note for today";
  noteInput.value = d.note ?? "";
  const save = debounce(async () => {
    try {
      await invoke("set_daily_note", {
        id: d.id,
        note: noteInput.value.trim() ? noteInput.value : null,
      });
    } catch (e) { showError(String(e)); }
  }, 500);
  noteInput.addEventListener("input", save);
  body.appendChild(noteInput);

  el.appendChild(body);
  return el;
}

async function refreshToday() {
  try {
    const items = await invoke<TodayDaily[]>("list_today_daily");
    const list = $("#today-list");
    list.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No daily tasks. Create one with category=daily.";
      list.appendChild(empty);
    } else {
      items.forEach(d => list.appendChild(renderDaily(d)));
    }
    const date = items[0]?.date ?? new Date().toISOString().slice(0, 10);
    $("#today-date").textContent = date;
    showError(null);
  } catch (e) { showError(String(e)); }
}

function readFilter(): TaskFilter {
  const f: TaskFilter = {};
  const c = ($("#flt-context") as HTMLSelectElement).value;
  if (c) f.context = c as Context;
  const cat = ($("#flt-category") as HTMLSelectElement).value;
  if (cat) f.category = cat as Category;
  const tmpl = ($("#flt-template") as HTMLSelectElement).value;
  if (tmpl) f.is_template = tmpl === "true";
  const s = ($("#flt-status") as HTMLSelectElement).value;
  if (s) f.status = s as Status;
  return f;
}

async function refresh() {
  try {
    const tasks = await invoke<Task[]>("list_tasks", { filter: readFilter() });
    const list = $("#list");
    list.innerHTML = "";
    if (tasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No tasks";
      list.appendChild(empty);
    } else {
      tasks.forEach(t => list.appendChild(renderTask(t)));
    }
    showError(null);
  } catch (e) { showError(String(e)); }
}

window.addEventListener("DOMContentLoaded", () => {
  $("#create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = ($("#f-title") as HTMLInputElement).value.trim();
    if (!title) return;
    const todayChecked = ($("#f-due-today") as HTMLInputElement).checked;
    const due = todayChecked
      ? new Date().toLocaleDateString("sv")
      : ($("#f-due") as HTMLInputElement).value;
    const note = ($("#f-note") as HTMLTextAreaElement).value.trim();
    try {
      await invoke("create_task", {
        input: {
          title,
          context: ($("#f-context") as HTMLSelectElement).value,
          category: ($("#f-category") as HTMLSelectElement).value,
          is_template: ($("#f-template") as HTMLInputElement).checked,
          due_date: due || null,
          note: note || null,
        },
      });
      const isDaily = ($("#f-category") as HTMLSelectElement).value === "daily";
      ($("#create-form") as HTMLFormElement).reset();
      if (isDaily) await invoke("ensure_today_instances");
      await Promise.all([refresh(), refreshToday()]);
    } catch (err) { showError(String(err)); }
  });

  $("#f-due-today").addEventListener("change", () => {
    const checked = ($("#f-due-today") as HTMLInputElement).checked;
    ($("#f-due") as HTMLInputElement).hidden = checked;
  });

  const updateDueDateVisibility = () => {
    const isDaily = ($("#f-category") as HTMLSelectElement).value === "daily";
    ($("#f-due-today") as HTMLElement).closest("label")!.hidden = isDaily;
    ($("#f-due") as HTMLInputElement).hidden = isDaily || ($("#f-due-today") as HTMLInputElement).checked;
  };
  $("#f-category").addEventListener("change", updateDueDateVisibility);

  ["flt-context", "flt-category", "flt-template", "flt-status"].forEach(id => {
    $(`#${id}`).addEventListener("change", refresh);
  });
  $("#flt-refresh").addEventListener("click", refresh);

  // Refresh Today whenever archive/edit changes a daily task — easier: do it in archive button.
  // Listen for midnight reset event from backend scheduler.
  listen("daily-reset", () => { refreshToday(); });

  $("#edit-form").addEventListener("submit", submitEdit);
  $("#e-cancel").addEventListener("click", closeEdit);
  $("#edit-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEdit();
  });

  $("#spawn-form").addEventListener("submit", submitSpawn);
  $("#sp-cancel").addEventListener("click", closeSpawn);
  $("#spawn-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSpawn();
  });
  $("#sp-include-done").addEventListener("change", refreshSpawned);

  $("#hm-cancel").addEventListener("click", closeHistModal);
  $("#hm-save").addEventListener("click", saveHistModal);
  $("#hist-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeHistModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#edit-modal").hidden) closeEdit();
    else if (!$("#spawn-modal").hidden) closeSpawn();
    else if (!$("#hist-modal").hidden) closeHistModal();
  });

  // History collapse + range
  $("#hist-toggle").addEventListener("click", () => {
    const body = $("#hist-body");
    const controls = $("#hist-controls");
    const open = body.hidden;
    body.hidden = !open;
    controls.hidden = !open;
    ($("#hist-toggle") as HTMLButtonElement).textContent = open ? "▾ History" : "▸ History";
    if (open) refreshHistory();
  });
  $("#hist-days").addEventListener("change", refreshHistory);

  document.querySelectorAll<HTMLButtonElement>(".tabs .tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view as "heatmap" | "calendar";
      if (view) setHistView(view);
    });
  });

  $("#cal-prev").addEventListener("click", () => calNav(-1));
  $("#cal-next").addEventListener("click", () => calNav(1));
  $("#cal-today").addEventListener("click", calGoToday);

  // Refresh history when daily-reset fires (already listening above) — augment:
  listen("daily-reset", () => { refreshHistory(); });

  // Settings panel open/close
  document.getElementById("settings-btn")!.addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("settings-panel")!;
    panel.hidden = !panel.hidden;
  });
  document.getElementById("theme-toggle")!.addEventListener("click", (e) => {
    e.stopPropagation();
    ThemeManager.toggle();
  });
  document.addEventListener("click", () => {
    const panel = document.getElementById("settings-panel");
    if (panel) panel.hidden = true;
  });

  refresh();
  refreshToday();
  refreshSpawned();
});
