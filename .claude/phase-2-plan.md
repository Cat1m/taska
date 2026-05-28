# Taska — Phase 2 Plan

Phase 1 (F01-F05 + F03) đã xong: desktop app offline-first dùng được hàng ngày với CRUD task, daily reset + midnight scheduler, template + spawn flow, markdown render, daily history heatmap.

Phase 2 mục tiêu: **data an toàn, chuyển được giữa máy, sẵn sàng cho Flutter mobile**.

---

## Context

User dùng Taska personal trên 1 máy desktop. Phase 2 cần:
1. Backup/restore thủ công (chuyển máy mới, snapshot định kỳ).
2. Cloud sync với Firebase Firestore để Phase 3 (Flutter mobile) có thể dùng cùng data.

SQLite local vẫn là **source of truth**. Firebase chỉ là sync target — app phải hoạt động hoàn toàn offline.

---

## F06 — Export / Import (JSON)

### Goal
Một button "Export" dump toàn bộ data ra file `.json`; một button "Import" đọc file và insert vào SQLite. UUID giữ nguyên (Option A trong plan.xml gốc) — không cần merge logic vì 1 user.

### Data model (file format)

```json
{
  "version": "1.0.0",
  "exported_at": "2026-05-21T10:00:00Z",
  "data": {
    "tasks": [ { /* full Task row */ } ],
    "daily_instances": [ { /* full DailyInstance row */ } ],
    "spawned_tasks": [ { /* full SpawnedTask row */ } ]
  }
}
```

Boolean lưu dạng `true/false` trong JSON (convert từ SQLite `0/1`).

### Backend (`src-tauri/src/io.rs` mới)

- `export_data() -> ExportFile`
  - SELECT all rows từ 3 bảng.
  - Trả về struct serialize JSON.
  - Tauri command + dùng `tauri-plugin-dialog` (cần thêm) để mở Save dialog phía frontend.
  - Frontend nhận `ExportFile` JSON → ghi xuống file user chọn.

- `import_data(payload: ExportFile, mode: ImportMode) -> ImportSummary`
  - `mode = 'merge' | 'replace'`:
    - `merge`: `INSERT OR IGNORE` (UUID trùng thì skip). An toàn cho user import vào DB đang dùng.
    - `replace`: TRUNCATE 3 bảng rồi insert lại. Cho use case "máy mới, restore từ file".
  - Validate `version`. Phase 2 chỉ accept `1.0.0`.
  - Trả `ImportSummary { tasks_inserted, daily_instances_inserted, spawned_tasks_inserted, skipped }`.

- Dependencies thêm: `tauri-plugin-dialog = "2"`.

### Frontend

- Section mới "Backup" (collapsed, ngang hàng History) hoặc một nút trong header:
  - Button "Export…" → call `export_data` → dùng `@tauri-apps/plugin-dialog` `save()` chọn path → ghi file bằng `@tauri-apps/plugin-fs`.
  - Button "Import…" → `open()` dialog chọn `.json` → đọc nội dung → confirm dialog ("merge" hay "replace") → call `import_data` → hiển thị summary.
- Plugin frontend: `npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-fs`.

### Verification
- Export → kiểm tra JSON cấu trúc đúng, mở bằng text editor đọc được.
- Trên máy mới (hoặc xóa `taska.db` mô phỏng): import `replace` → mọi tab/section hiển thị đúng data cũ.
- Import lại file đã import (mode=merge) → summary nói skipped = total (không duplicate).

---

## F07 — Firebase Firestore Sync

### Goal
Mirror SQLite → Firestore (và pull về) để Flutter mobile (Phase 3) đọc/ghi cùng data. Offline-first: app không phụ thuộc Firebase để chạy.

### Approach

Firebase JS SDK ở Tauri **frontend** (Phase 1 plan đã chốt — không Rust SDK). Lý do: JS SDK matured, offline cache có sẵn, dễ share schema với Flutter (cloud_firestore Dart SDK cùng collection layout).

### Architecture

```
SQLite (source of truth)  ⇄  SyncEngine (TS)  ⇄  Firestore (mirror)
```

**SyncEngine** chạy ở frontend, có 3 luồng:
1. **Push** local changes lên Firestore khi có internet.
2. **Pull** Firestore changes về local SQLite (initial + onSnapshot listeners).
3. **Conflict resolution**: last-write-wins theo `updated_at` (đã có sẵn ở mọi entity).

### Schema thay đổi (migration 0002)

Thêm 2 cột vào 3 bảng để track sync state:
- `dirty INTEGER NOT NULL DEFAULT 1` — 1 nếu chưa push lên cloud (local change).
- `cloud_updated_at TEXT` — timestamp lần sync gần nhất từ cloud (để detect conflict).

Migration:
```sql
ALTER TABLE tasks           ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks           ADD COLUMN cloud_updated_at TEXT;
ALTER TABLE daily_instances ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE daily_instances ADD COLUMN cloud_updated_at TEXT;
ALTER TABLE spawned_tasks   ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE spawned_tasks   ADD COLUMN cloud_updated_at TEXT;
```

Mọi mutation backend hiện tại đã set `updated_at = now()`. Cần thêm: set `dirty = 1` ở mỗi mutation.

### Firestore layout

3 top-level collections (single-user nên không cần subcollection theo userId — nhưng để chuẩn bị multi-device cùng user, dùng `users/<uid>/{tasks|daily_instances|spawned_tasks}`).

Phase 2 dùng anonymous Firebase Auth → 1 stable `uid` per device. Sau này nếu cần share thì migrate sang email auth.

Document ID = SQLite row UUID (1-1 mapping, không phải Firestore auto-id).

### Backend (`src-tauri/src/sync.rs` mới)

Tauri commands phục vụ frontend SyncEngine:
- `list_dirty_tasks() -> Vec<Task>`
- `list_dirty_daily() -> Vec<DailyInstance>`
- `list_dirty_spawned() -> Vec<SpawnedTask>`
- `mark_synced(table, id, cloud_updated_at)` — set `dirty=0, cloud_updated_at=?`.
- `upsert_task_from_cloud(task)`, `upsert_daily_from_cloud(...)`, `upsert_spawned_from_cloud(...)`
  - Compare `cloud.updated_at` vs `local.updated_at`.
  - Nếu cloud mới hơn → overwrite local, `dirty=0`.
  - Nếu local mới hơn → skip (local sẽ push lên sau).

### Frontend (`src/sync/`)

Cấu trúc:
```
src/sync/
  firebase.ts     # initialize app, auth (anonymous), db
  push.ts         # poll dirty rows, write to Firestore
  pull.ts         # onSnapshot listeners on 3 collections
  engine.ts       # orchestrate push + pull, status indicator
```

- Initialize on app start (after DB ready).
- Status bar nhỏ ở UI: "🟢 synced" / "🟡 syncing…" / "🔴 offline" / "⚪ not signed in".
- Push trigger: timer 10s + ngay sau mỗi mutation (gọi sau `await invoke(...)`).
- Pull trigger: onSnapshot listeners (realtime).

### Dependencies
- Backend: không thêm (sync logic ở TS).
- Frontend: `npm install firebase`. Config trong `.env.local` (không commit).

### Auth

Firebase Auth anonymous lần đầu mở app → tạo `uid` lưu trong localStorage. Cùng user mở máy khác sẽ tạo `uid` khác — sẽ thấy data trống. **Cần giải pháp đăng nhập thực** (email link hoặc Google) trước khi multi-device hoạt động đúng. Đề xuất:

- Phase 2.5: thêm sign-in với Google (1 click). Migrate anonymous data lên user account khi sign-in lần đầu (`linkWithCredential`).

### Verification
- Mở app → status "synced", không có gì thay đổi.
- Tạo task → trong 10s thấy lên Firestore console.
- Delete task ở Firestore console → app local update (instance đổi/biến mất).
- Mở app trên máy khác cùng account → thấy đúng data.
- Tắt mạng → vẫn dùng được, status "offline"; bật lại mạng → catch up.

---

## Roadmap Phase 2

| # | Task | Phụ thuộc | Ước lượng |
|---|------|-----------|-----------|
| 1 | F06 Export | — | 0.5d |
| 2 | F06 Import (merge + replace) | F06 Export | 0.5d |
| 3 | F07 migration 0002 (dirty cols) | — | 0.5d |
| 4 | F07 backend sync commands | #3 | 0.5d |
| 5 | F07 Firebase setup + anon auth | — | 0.5d |
| 6 | F07 push engine | #4, #5 | 1d |
| 7 | F07 pull engine + conflict resolution | #6 | 1d |
| 8 | F07 status indicator UI | #6 | 0.25d |
| 9 | F07 Google sign-in + migrate anon | #5-8 | 0.5d |

Tổng: ~5d làm part-time.

---

## Risks / Open questions

1. **Firestore cost**: free tier 50k reads/day, 20k writes/day. 1 user dùng cá nhân không vấn đề. Nhưng onSnapshot streaming có thể spike reads — cần cap listener (chỉ listen 90 ngày gần nhất cho `daily_instances`).
2. **Anonymous auth migration**: Firebase support `linkWithCredential` từ anon → permanent. Cần test kỹ luồng này, dễ mất data nếu làm sai.
3. **Schema evolution**: nếu sau này thêm field, cần coordinated migration ở cả SQLite (migration) lẫn Firestore (backfill script). Document field schema rõ ràng trong code.
4. **CSP**: Tauri webview có CSP default. Phải allow Firebase domains trong `tauri.conf.json` security CSP.
5. **Time sync**: client clock skew có thể gây last-write-wins sai. Cho Phase 2 chấp nhận; nếu thấy bug rõ thì dùng Firestore `serverTimestamp()` thay vì client `updated_at`.

---

## Out of scope (defer)

- Sharing data với người khác (multi-user collaboration).
- Cloud backup history / versioning.
- Encryption at rest (Firestore data nhạy cảm cá nhân nhưng đã có Firebase rules bảo vệ theo uid).
- Real-time presence ("user X is editing").

Những thứ này thuộc Phase 4 (Power Features) hoặc không bao giờ cần cho single-user use case.
