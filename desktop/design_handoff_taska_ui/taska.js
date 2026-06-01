/* ============================================================
   Taska — state + render + interactivity
   Mirrors the Rust data model:
     tasks(title, context, category, status, is_template, due_date, note)
     daily_instances(task_id, date, done, note)
     spawned_tasks(parent template -> instances)
   Enums serialize lowercase: personal/work, daily/normal, active/archived
   ============================================================ */

const TODAY = new Date(2026, 5, 1); // Jun 1 2026 (month 0-indexed)
const fmtISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const TODAY_ISO = fmtISO(TODAY);

/* ---- seed tasks ---- */
const tasks = [
  { id: 1,  title: "Morning standup notes",      context: "work",     category: "daily",  status: "active",   is_template: false, due_date: null,         note: "Capture blockers + what shipped yesterday before 09:30." },
  { id: 2,  title: "Review PR queue",            context: "work",     category: "daily",  status: "active",   is_template: false, due_date: null,         note: "Clear anything older than 24h. Tag @here if stuck." },
  { id: 3,  title: "Drink water (2L)",           context: "personal", category: "daily",  status: "active",   is_template: false, due_date: null,         note: "" },
  { id: 4,  title: "Read 20 pages",              context: "personal", category: "daily",  status: "active",   is_template: false, due_date: null,         note: "Currently: 'The Pragmatic Programmer'." },
  { id: 5,  title: "Ship Tauri 2.x migration",   context: "work",     category: "normal", status: "active",   is_template: false, due_date: "2026-06-04", note: "Upgrade IPC layer, audit capability permissions, re-test tray." },
  { id: 6,  title: "Renew domain taska.dev",     context: "work",     category: "normal", status: "active",   is_template: false, due_date: "2026-06-02", note: "Auto-renew failed last cycle — do it manually." },
  { id: 7,  title: "Dentist appointment",        context: "personal", category: "normal", status: "active",   is_template: false, due_date: "2026-05-29", note: "Reschedule — overdue." },
  { id: 8,  title: "Weekly retro template",      context: "work",     category: "normal", status: "active",   is_template: true,  due_date: null,         note: "Spawns one instance every Friday. Wins / drags / next." },
  { id: 9,  title: "Invoice client batch",       context: "work",     category: "normal", status: "active",   is_template: true,  due_date: null,         note: "Template — spawn per billing cycle." },
  { id: 10, title: "Plan weekend trip",          context: "personal", category: "normal", status: "active",   is_template: false, due_date: "2026-06-12", note: "" },
  { id: 11, title: "Meditate 10 min",            context: "personal", category: "daily",  status: "active",   is_template: false, due_date: null,         note: "" },
  { id: 12, title: "Archive Q1 reports",         context: "work",     category: "normal", status: "archived", is_template: false, due_date: null,         note: "Done — moved to cold storage 2026-04-02." },
  { id: 13, title: "Old gym routine",            context: "personal", category: "daily",  status: "archived", is_template: false, due_date: null,         note: "Replaced by new plan." },
];

/* ---- daily_instances for TODAY (task_id, date, done, note) ---- */
const dailyInstances = [
  { task_id: 1,  date: TODAY_ISO, done: true,  note: "Backend deploy still blocked on staging creds.", streak: 12 },
  { task_id: 2,  date: TODAY_ISO, done: true,  note: "", streak: 8 },
  { task_id: 3,  date: TODAY_ISO, done: false, note: "", streak: 23 },
  { task_id: 4,  date: TODAY_ISO, done: false, note: "", streak: 5 },
  { task_id: 11, date: TODAY_ISO, done: false, note: "", streak: 31 },
];

/* ---- spawned_tasks: instances spawned from template tasks ---- */
const spawnedTasks = [
  { id: 101, parent_id: 8, title: "Weekly retro — May W4", spawned_at: "2026-05-23", status: "done",     context: "work" },
  { id: 102, parent_id: 8, title: "Weekly retro — May W5", spawned_at: "2026-05-30", status: "active",   context: "work" },
  { id: 103, parent_id: 8, title: "Weekly retro — Jun W1", spawned_at: "2026-06-06", status: "pending",  context: "work" },
  { id: 104, parent_id: 9, title: "Invoice — Acme Corp",   spawned_at: "2026-05-28", status: "done",     context: "work" },
  { id: 105, parent_id: 9, title: "Invoice — Globex",      spawned_at: "2026-05-31", status: "active",   context: "work" },
  { id: 106, parent_id: 9, title: "Invoice — Initech",     spawned_at: "2026-06-01", status: "pending",  context: "work" },
];

/* ---- UI state ---- */
const state = {
  view: "myday",
  mydayFilter: "all",   // all | personal | work
  taskFilter: "active",
  search: "",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const longDate = (d) => `${DOWS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const taskById = (id) => tasks.find((t) => t.id === id);

/* ============================================================
   Heatmap data (deterministic pseudo-random completion levels)
   ============================================================ */
function buildHeatData() {
  // 18 weeks back, 7 days each, ending today
  const days = [];
  const totalDays = 18 * 7;
  const start = new Date(TODAY);
  start.setDate(start.getDate() - (totalDays - 1));
  // align start to Sunday
  start.setDate(start.getDate() - start.getDay());

  let seed = 1337;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const cur = new Date(start);
  while (cur <= TODAY) {
    const dow = cur.getDay();
    let lvl;
    const r = rng();
    // weekends lighter, gentle upward trend
    if (dow === 0 || dow === 6) lvl = r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3;
    else lvl = r < 0.12 ? 0 : r < 0.32 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 : 4;
    days.push({ date: new Date(cur), iso: fmtISO(cur), lvl, count: lvl });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
const HEAT = buildHeatData();

function renderHeatmap() {
  const wrap = $("#heatmap");
  // build week columns
  const weeks = [];
  for (let i = 0; i < HEAT.length; i += 7) weeks.push(HEAT.slice(i, i + 7));

  // month labels row
  const monthRow = document.createElement("div");
  monthRow.className = "heat-month-row";
  let lastMonth = -1;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  weeks.forEach((wk) => {
    const m = wk[0].date.getMonth();
    const span = document.createElement("span");
    span.style.width = "16px";
    if (m !== lastMonth) { span.textContent = monthNames[m]; lastMonth = m; span.style.width = "auto"; span.style.minWidth = "16px"; }
    monthRow.appendChild(span);
  });

  const cols = document.createElement("div");
  cols.className = "heat-cols";
  // recompute today completion from instances
  const todayLvl = liveTodayLevel();
  weeks.forEach((wk) => {
    const col = document.createElement("div");
    col.className = "heat-col";
    wk.forEach((d) => {
      const cell = document.createElement("div");
      cell.className = "heat-cell";
      let lvl = d.lvl;
      if (d.iso === TODAY_ISO) { lvl = todayLvl; cell.classList.add("today"); }
      if (d.date > TODAY) { cell.style.visibility = "hidden"; }
      cell.dataset.lvl = lvl;
      cell.title = `${d.iso} · ${lvl}/4 daily done`;
      col.appendChild(cell);
    });
    cols.appendChild(col);
  });

  const heat = document.createElement("div");
  heat.className = "heat";
  heat.appendChild(monthRow);
  heat.appendChild(cols);

  wrap.innerHTML = "";
  wrap.appendChild(heat);
}

function liveTodayLevel() {
  const done = dailyInstances.filter((i) => i.done).length;
  const total = dailyInstances.length;
  if (total === 0) return 0;
  const ratio = done / total;
  if (ratio === 0) return 0;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio < 1) return 3;
  return 4;
}

/* ============================================================
   Tasks view
   ============================================================ */
function dueMeta(iso) {
  if (!iso) return { txt: "—", cls: "" };
  const d = new Date(iso + "T00:00:00");
  const diff = Math.round((d - TODAY) / 86400000);
  let txt;
  if (diff < 0) txt = `${Math.abs(diff)}d overdue`;
  else if (diff === 0) txt = "today";
  else if (diff === 1) txt = "tomorrow";
  else txt = `in ${diff}d`;
  const cls = diff < 0 ? "over" : diff <= 2 ? "soon" : "";
  return { txt, cls, iso };
}

function renderTasks() {
  const list = $("#tasks-list");
  const rows = tasks.filter((t) =>
    t.status === state.taskFilter &&
    (state.search === "" || (t.title + " " + t.note).toLowerCase().includes(state.search))
  );

  if (rows.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">∅</div>No ${state.taskFilter} tasks${state.search ? " matching filter" : ""}.</div>`;
    return;
  }

  list.innerHTML = rows.map((t) => {
    const dm = dueMeta(t.due_date);
    return `
    <div class="task-row ${t.status === "archived" ? "archived" : ""}" data-id="${t.id}">
      <div class="chk ${t.status === "archived" ? "done" : ""}" data-act="toggle"></div>
      <div class="task-main">
        <div class="task-title">
          ${t.title}
          ${t.is_template ? '<span class="tmpl">template</span>' : ""}
        </div>
        ${t.note ? `<div class="task-note">${t.note}</div>` : ""}
      </div>
      <div class="badges">
        <span class="badge ${t.context}"><span class="d"></span>${t.context}</span>
        <span class="badge ${t.category}"><span class="d"></span>${t.category}</span>
      </div>
      <div class="due ${dm.cls}">
        <span class="label">due</span>${dm.txt}
      </div>
    </div>`;
  }).join("");

  // counts
  $("#count-tasks").textContent = tasks.filter((t) => t.status === "active").length;
}

/* ============================================================
   My Day view — unified today overview across both contexts
   ============================================================ */
function renderMyDay() {
  $("#myday-date").textContent = longDate(TODAY);
  const list = $("#myday-list");
  let insts = dailyInstances
    .map((i) => ({ ...i, task: taskById(i.task_id) }))
    .filter((i) => i.task);
  if (state.mydayFilter !== "all") insts = insts.filter((i) => i.task.context === state.mydayFilter);

  const done = insts.filter((i) => i.done).length;
  $("#myday-meta").textContent = `${done}/${insts.length} done`;

  if (insts.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">∅</div>Nothing scheduled for <b>${state.mydayFilter}</b> today.</div>`;
    return;
  }

  list.innerHTML = insts.map((i) => `
    <div class="inst-row" data-task="${i.task_id}">
      <div class="chk ${i.done ? "done" : ""}" data-act="toggle-inst"></div>
      <div class="inst-main">
        <div class="inst-top">
          <span class="inst-title ${i.done ? "done" : ""}">${i.task.title}</span>
          <span class="badge ${i.task.context}"><span class="d"></span>${i.task.context}</span>
          <span class="inst-streak">▲ ${i.streak}d streak</span>
        </div>
        <div class="note-field">
          <textarea placeholder="Add a note for today…" data-task="${i.task_id}">${i.note}</textarea>
          <span class="note-status" data-task="${i.task_id}"></span>
        </div>
      </div>
    </div>
  `).join("");
}

/* ============================================================
   Daily view
   ============================================================ */
function renderDaily() {
  renderHeatmap();
  renderDailyStats();
}

function renderDailyStats() {
  const done = dailyInstances.filter((i) => i.done).length;
  const total = dailyInstances.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("#stat-today").innerHTML = `${done}<span style="color:var(--fg-3)">/${total}</span>`;
  $("#stat-pct").innerHTML = `<span class="pct">${pct}%</span>`;
  // best streak across instances
  const best = Math.max(0, ...dailyInstances.map((i) => i.streak));
  $("#stat-streak").textContent = best + "d";
}

/* ============================================================
   Spawned view
   ============================================================ */
function renderSpawned() {
  const wrap = $("#spawned-list");
  const templates = tasks.filter((t) => t.is_template);

  if (templates.length === 0) {
    wrap.innerHTML = `<div class="empty"><div class="big">∅</div>No template tasks.<br>Mark a task as template to spawn instances.</div>`;
    $("#count-spawned").textContent = "0";
    return;
  }

  let totalSpawned = 0;
  wrap.innerHTML = templates.map((tmpl) => {
    const kids = spawnedTasks.filter((s) => s.parent_id === tmpl.id);
    totalSpawned += kids.length;
    return `
    <div class="spawn-group">
      <div class="spawn-group-head">
        <span class="branch">⑂</span>
        <span class="tname">${tmpl.title}</span>
        <span class="badge ${tmpl.context}"><span class="d"></span>${tmpl.context}</span>
        <span class="count">${kids.length} spawned</span>
      </div>
      ${kids.map((s, idx) => {
        const last = idx === kids.length - 1;
        const dm = dueMeta(s.spawned_at);
        const pillCls = s.status === "done" ? "done-p" : s.status === "pending" ? "pending" : "archived-p";
        const pillTxt = s.status === "done" ? "done" : s.status === "pending" ? "scheduled" : "active";
        return `
        <div class="spawn-row">
          <span class="conn">${last ? "└" : "├"}</span>
          <div class="chk ${s.status === "done" ? "done" : ""}"></div>
          <span class="stitle">${s.title}</span>
          <span class="sdate"><span class="label">spawned </span>${s.spawned_at}</span>
          <span class="pill ${pillCls}">${pillTxt}</span>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");

  $("#count-spawned").textContent = totalSpawned;
}

/* ============================================================
   View / context switching
   ============================================================ */
function setView(v) {
  state.view = v;
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === v));
  $$(".view").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
  rerender();
}

function rerender() {
  if (state.view === "myday") renderMyDay();
  if (state.view === "tasks") renderTasks();
  if (state.view === "daily") renderDaily();
  if (state.view === "spawned") renderSpawned();
  // keep nav counts fresh regardless of view
  $("#count-myday").textContent = dailyInstances.filter((i) => !i.done).length;
  $("#count-tasks").textContent = tasks.filter((t) => t.status === "active").length;
  $("#count-daily").textContent = dailyInstances.length;
  $("#count-spawned").textContent = spawnedTasks.length;
}

/* ============================================================
   Modal
   ============================================================ */
function openModal(mode, task) {
  const m = $("#modal-scrim");
  const titles = { create: "Create task", edit: "Edit task", spawn: "Spawn instance" };
  $("#modal-title").textContent = titles[mode] || "Task";
  $("#modal-mode").textContent = mode;
  // populate
  $("#f-title").value = task ? task.title : "";
  $("#f-note").value = task ? (task.note || "") : "";
  $("#f-due").value = task && task.due_date ? task.due_date : "";
  setChoice("ctx", task ? task.context : "personal");
  setChoice("cat", task ? task.category : "normal");
  setSwitch($("#f-template"), task ? task.is_template : false);
  // spawn mode: lock fields, show as derived
  $("#spawn-fields").style.display = mode === "spawn" ? "block" : "none";
  $("#f-save").textContent = mode === "spawn" ? "Spawn" : mode === "edit" ? "Save changes" : "Create";
  m.classList.add("open");
  setTimeout(() => $("#f-title").focus(), 60);
}
function closeModal() { $("#modal-scrim").classList.remove("open"); }

function setChoice(group, val) {
  $$(`.choice[data-group="${group}"] button`).forEach((b) => b.classList.toggle("active", b.dataset.v === val));
}
function setSwitch(el, on) { el.classList.toggle("on", on); }

/* ============================================================
   Reset banner (simulated daily-reset event)
   ============================================================ */
function fireDailyReset() {
  // reset today's instances done state (midnight rollover)
  dailyInstances.forEach((i) => { i.done = false; });
  const banner = $("#reset-banner");
  banner.classList.add("show");
  if (state.view === "daily") renderDaily();
  rerender();
  clearTimeout(window.__resetTimer);
  window.__resetTimer = setTimeout(() => banner.classList.remove("show"), 6000);
}

/* ============================================================
   Wiring
   ============================================================ */
function init() {
  // nav
  $$(".nav-item").forEach((n) => n.addEventListener("click", () => setView(n.dataset.view)));

  // My Day filter chips
  $$("#myday-chips .chip").forEach((b) => b.addEventListener("click", () => {
    state.mydayFilter = b.dataset.f;
    $$("#myday-chips .chip").forEach((x) => x.classList.toggle("active", x === b));
    renderMyDay();
  }));

  // task filter
  $$("#task-filter button").forEach((b) => b.addEventListener("click", () => {
    state.taskFilter = b.dataset.filter;
    $$("#task-filter button").forEach((x) => x.classList.toggle("active", x === b));
    renderTasks();
  }));

  // search
  $("#task-search").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase(); renderTasks(); });

  // delegate clicks within tasks list
  $("#tasks-list").addEventListener("click", (e) => {
    const chk = e.target.closest('[data-act="toggle"]');
    const row = e.target.closest(".task-row");
    if (!row) return;
    const id = +row.dataset.id;
    const t = taskById(id);
    if (chk) {
      // toggle archive/active
      t.status = t.status === "active" ? "archived" : "active";
      renderTasks(); rerender();
      e.stopPropagation();
      return;
    }
    openModal("edit", t);
  });

  // My Day list: toggle done + debounced note
  $("#myday-list").addEventListener("click", (e) => {
    const chk = e.target.closest('[data-act="toggle-inst"]');
    if (!chk) return;
    const row = e.target.closest(".inst-row");
    const i = dailyInstances.find((d) => d.task_id === +row.dataset.task);
    i.done = !i.done;
    chk.classList.toggle("done", i.done);
    row.querySelector(".inst-title").classList.toggle("done", i.done);
    $("#myday-meta").textContent = (() => {
      let insts = dailyInstances.filter((x) => state.mydayFilter === "all" || (taskById(x.task_id) || {}).context === state.mydayFilter);
      return `${insts.filter((x) => x.done).length}/${insts.length} done`;
    })();
    $("#count-myday").textContent = dailyInstances.filter((d) => !d.done).length;
  });

  // debounced note save (500ms)
  const timers = {};
  $("#myday-list").addEventListener("input", (e) => {
    const ta = e.target.closest("textarea[data-task]");
    if (!ta) return;
    const id = ta.dataset.task;
    const statusEl = $(`.note-status[data-task="${id}"]`);
    statusEl.textContent = "saving…"; statusEl.className = "note-status saving";
    clearTimeout(timers[id]);
    timers[id] = setTimeout(() => {
      const inst = dailyInstances.find((d) => d.task_id === +id);
      if (inst) inst.note = ta.value;
      statusEl.textContent = "✓ saved"; statusEl.className = "note-status saved";
      setTimeout(() => { statusEl.className = "note-status"; }, 1400);
    }, 500);
  });

  // modal
  $("#btn-new").addEventListener("click", () => openModal("create", null));
  $("#btn-new-2").addEventListener("click", () => openModal("create", null));
  $("#modal-close").addEventListener("click", closeModal);
  $("#f-cancel").addEventListener("click", closeModal);
  $("#f-save").addEventListener("click", closeModal);
  $("#modal-scrim").addEventListener("click", (e) => { if (e.target.id === "modal-scrim") closeModal(); });
  // choice groups
  $$(".choice button").forEach((b) => b.addEventListener("click", () => setChoice(b.closest(".choice").dataset.group, b.dataset.v)));
  // template switch
  $("#f-template").addEventListener("click", function () { this.classList.toggle("on"); });

  // reset banner
  $("#btn-reset").addEventListener("click", fireDailyReset);
  $("#reset-dismiss").addEventListener("click", () => $("#reset-banner").classList.remove("show"));

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (e.key === "n" && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault(); openModal("create", null);
    }
    if ((e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
      setView({ "1": "myday", "2": "tasks", "3": "spawned", "4": "daily" }[e.key]);
    }
  });

  // theme toggle (persisted)
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    $("#theme-ico").textContent = t === "light" ? "◐" : "◑";
    $("#theme-label").textContent = t === "light" ? "dark" : "light";
    // force a full style recompute so var()-based colors on already-painted
    // (incl. static) nodes don't keep stale values across the theme swap
    const html = document.documentElement;
    html.style.display = "none";
    void html.offsetHeight;
    html.style.display = "";
    try { localStorage.setItem("taska-theme", t); } catch (e) {}
  };
  let theme = "dark";
  try { theme = localStorage.getItem("taska-theme") || "dark"; } catch (e) {}
  applyTheme(theme);
  $("#theme-toggle").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    rerender(); // rebuild var()-dependent nodes so theme swap is clean
  });

  setView("myday");
}

document.addEventListener("DOMContentLoaded", init);
