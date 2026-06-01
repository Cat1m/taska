import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ---- Types ----

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

// ---- App state ----

let currentView: "myday" | "tasks" | "spawned" | "daily" = "myday";
let myDayFilter: "all" | "personal" | "work" = "all";
let myDayInstances: TodayDaily[] = [];
const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---- Theme ----

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

// ---- View navigation ----

function setView(v: "myday" | "tasks" | "spawned" | "daily") {
  currentView = v;
  document.querySelectorAll<HTMLElement>(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.goto === v);
  });
  document.querySelectorAll<HTMLElement>(".view").forEach(section => {
    section.classList.toggle("active", section.dataset.view === v);
  });
}

// ---- My Day ----

async function loadMyDay() {
  try {
    myDayInstances = await invoke<TodayDaily[]>("list_today_daily");
  } catch (e) {
    console.error("list_today_daily failed:", e);
    myDayInstances = [];
  }
  renderMyDay();
  refreshMyDayPills();
}

function renderMyDay() {
  const filtered = myDayFilter === "all"
    ? myDayInstances
    : myDayInstances.filter(i => i.context === myDayFilter);

  const list = document.getElementById("myday-list")!;
  list.innerHTML = "";

  updateMyDayMeta();

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = myDayFilter === "all"
      ? "No daily tasks today. Create one with + New."
      : `No ${myDayFilter} tasks today.`;
    list.appendChild(empty);
    return;
  }

  for (const inst of filtered) {
    list.appendChild(buildInstanceRow(inst));
  }
}

function buildInstanceRow(inst: TodayDaily): HTMLElement {
  const row = document.createElement("div");
  row.className = `instance-row${inst.is_done ? " is-done" : ""}`;
  row.id = `row-${inst.id}`;

  // Checkbox column
  const chkWrap = document.createElement("label");
  chkWrap.className = "chk-wrap";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.className = "chk";
  chk.checked = inst.is_done;
  chk.addEventListener("change", () => toggleDone(inst.id, chk.checked));
  chkWrap.appendChild(chk);
  row.appendChild(chkWrap);

  // Body column
  const body = document.createElement("div");
  body.className = "instance-body";

  // Title row: title + context badge
  const titleRow = document.createElement("div");
  titleRow.className = "instance-title-row";

  const titleEl = document.createElement("span");
  titleEl.className = `instance-title${inst.is_done ? " done" : ""}`;
  titleEl.textContent = inst.title;
  titleRow.appendChild(titleEl);

  const ctxBadge = document.createElement("span");
  ctxBadge.className = `badge ctx-${inst.context}`;
  ctxBadge.textContent = inst.context;
  titleRow.appendChild(ctxBadge);

  body.appendChild(titleRow);

  // Note textarea
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

  // Auto-size note after render
  requestAnimationFrame(() => autoResize(noteArea));

  return row;
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

async function toggleDone(id: string, done: boolean) {
  const inst = myDayInstances.find(i => i.id === id);
  if (inst) inst.is_done = done;

  // Optimistic UI update
  const row = document.getElementById(`row-${id}`);
  if (row) {
    row.classList.toggle("is-done", done);
    row.querySelector(".instance-title")?.classList.toggle("done", done);
  }
  updateMyDayMeta();
  refreshMyDayPills();

  try {
    await invoke("toggle_daily_done", { id, isDone: done });
  } catch (e) {
    // Revert on error
    if (inst) inst.is_done = !done;
    if (row) {
      row.classList.toggle("is-done", !done);
      row.querySelector(".instance-title")?.classList.toggle("done", !done);
      const chk = row.querySelector<HTMLInputElement>(".chk");
      if (chk) chk.checked = !done;
    }
    updateMyDayMeta();
    refreshMyDayPills();
    console.error("toggle_daily_done failed:", e);
  }
}

function updateMyDayMeta() {
  const meta = document.getElementById("myday-meta")!;
  const total = myDayInstances.length;
  const done = myDayInstances.filter(i => i.is_done).length;
  meta.textContent = total > 0 ? `${done}/${total} done` : "";
}

function refreshMyDayPills() {
  const total = myDayInstances.length;
  const done = myDayInstances.filter(i => i.is_done).length;
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
        if (statusEl.textContent === "✓ saved") {
          statusEl.textContent = "";
          statusEl.className = "save-status";
        }
        if (hint.textContent === "✓ saved") {
          hint.textContent = "";
          hint.className = "autosave-hint";
        }
      }, 1400);
    } catch (e) {
      statusEl.textContent = "⚠ error";
      statusEl.className = "save-status";
      hint.textContent = "⚠ save failed";
      hint.className = "autosave-hint";
      console.error("set_daily_note failed:", e);
    }
  }, 500);

  noteTimers.set(id, timer);
}

// ---- Nav counts (requires backend fetch for tasks + spawned) ----

async function updateNavCounts() {
  refreshMyDayPills();
  try {
    const [tasks, spawned] = await Promise.all([
      invoke<Task[]>("list_tasks", { filter: { status: "active" } }),
      invoke<Spawned[]>("list_spawned", {}),
    ]);
    const tasksPill = document.getElementById("cnt-tasks")!;
    tasksPill.textContent = tasks.length > 0 ? String(tasks.length) : "";
    const spawnedPill = document.getElementById("cnt-spawned")!;
    spawnedPill.textContent = spawned.length > 0 ? String(spawned.length) : "";
  } catch (e) {
    console.error("updateNavCounts failed:", e);
  }
}

// ---- Modal ----

function setChoice(group: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] .choice`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.v === value);
  });
}

function getChoice(group: string): string {
  return document.querySelector<HTMLButtonElement>(
    `[data-group="${group}"] .choice.active`
  )?.dataset.v ?? "";
}

function openCreateModal(defaultCategory: Category = "daily") {
  (document.getElementById("modal-title")!).textContent = "Create task";
  (document.getElementById("modal-mode-tag")!).textContent = "CREATE";
  (document.getElementById("m-title") as HTMLInputElement).value = "";
  (document.getElementById("m-note") as HTMLTextAreaElement).value = "";
  (document.getElementById("m-due") as HTMLInputElement).value = "";
  (document.getElementById("m-template") as HTMLInputElement).checked = false;
  const statusGroup = document.getElementById("status-group");
  if (statusGroup) statusGroup.style.display = "none";
  setChoice("context", "personal");
  setChoice("category", defaultCategory);
  setChoice("status", "active");
  document.getElementById("modal-scrim")!.classList.remove("hidden");
  setTimeout(() => (document.getElementById("m-title") as HTMLInputElement).focus(), 50);
}

function closeModal() {
  document.getElementById("modal-scrim")!.classList.add("hidden");
}

async function saveModal() {
  const titleInput = document.getElementById("m-title") as HTMLInputElement;
  const title = titleInput.value.trim();
  if (!title) { titleInput.focus(); return; }

  const context = getChoice("context") as Context;
  const category = getChoice("category") as Category;
  const is_template = (document.getElementById("m-template") as HTMLInputElement).checked;
  const due = (document.getElementById("m-due") as HTMLInputElement).value;
  const note = (document.getElementById("m-note") as HTMLTextAreaElement).value.trim();

  try {
    await invoke("create_task", {
      input: {
        title,
        context,
        category,
        is_template,
        due_date: due || null,
        note: note || null,
      },
    });
    if (category === "daily") {
      await invoke("ensure_today_instances");
    }
    closeModal();
    await loadMyDay();
    await updateNavCounts();
  } catch (e) {
    console.error("create_task failed:", e);
  }
}

// ---- Reset banner ----

function showResetBanner() {
  const banner = document.getElementById("reset-banner")!;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 6000);
}

// ---- Helpers ----

function formatDateLong(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ---- Init ----

window.addEventListener("DOMContentLoaded", async () => {
  // Apply saved or system theme
  const saved = localStorage.getItem(THEME_KEY) as "dark" | "light" | null;
  const sys = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved ?? sys);

  // Today date subtitle
  const dateSub = document.getElementById("today-date-sub")!;
  dateSub.textContent = formatDateLong();

  // Window controls (decorations: false)
  try {
    const appWindow = getCurrentWindow();
    document.getElementById("win-min")!.addEventListener("click", () => appWindow.minimize());
    document.getElementById("win-max")!.addEventListener("click", () => appWindow.toggleMaximize());
    document.getElementById("win-close")!.addEventListener("click", () => appWindow.close());
  } catch {
    // Native decorations active — dots are cosmetic only
  }

  // Theme toggle
  document.getElementById("theme-btn")!.addEventListener("click", toggleTheme);

  // Sidebar navigation
  document.querySelectorAll<HTMLElement>(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const v = item.dataset.goto as typeof currentView;
      if (v) setView(v);
    });
  });

  // My Day filter chips
  document.querySelectorAll<HTMLButtonElement>(".chip[data-f]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip[data-f]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      myDayFilter = chip.dataset.f as typeof myDayFilter;
      renderMyDay();
    });
  });

  // New task button
  document.getElementById("new-task-btn")!.addEventListener("click", () => openCreateModal("daily"));

  // Modal wiring
  document.getElementById("modal-close")!.addEventListener("click", closeModal);
  document.getElementById("modal-cancel")!.addEventListener("click", closeModal);
  document.getElementById("modal-save")!.addEventListener("click", saveModal);
  document.getElementById("modal-scrim")!.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Choice group buttons
  document.querySelectorAll<HTMLButtonElement>(".choice").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest<HTMLElement>("[data-group]")?.dataset.group;
      if (group) setChoice(group, btn.dataset.v ?? "");
    });
  });

  // Reset banner dismiss
  document.getElementById("dismiss-reset")!.addEventListener("click", () => {
    document.getElementById("reset-banner")!.classList.add("hidden");
  });

  // Dev: simulate daily-reset
  document.getElementById("sim-reset")!.addEventListener("click", async () => {
    try { await invoke("ensure_today_instances"); } catch {}
    await loadMyDay();
    showResetBanner();
  });

  // Keyboard shortcuts (ignored when typing)
  document.addEventListener("keydown", e => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    const inInput = tag === "input" || tag === "textarea" || tag === "select";

    if (e.key === "Escape") {
      if (!document.getElementById("modal-scrim")!.classList.contains("hidden")) {
        closeModal();
      }
      return;
    }

    if (!inInput) {
      if (e.key === "1") setView("myday");
      else if (e.key === "2") setView("tasks");
      else if (e.key === "3") setView("spawned");
      else if (e.key === "4") setView("daily");
      else if (e.key === "n" || e.key === "N") openCreateModal("daily");
    }
  });

  // Backend daily-reset event
  listen("daily-reset", async () => {
    try { await invoke("ensure_today_instances"); } catch {}
    await loadMyDay();
    showResetBanner();
  });

  // Initial data load
  try {
    await invoke("ensure_today_instances");
  } catch {}
  await loadMyDay();
  await updateNavCounts();
});
