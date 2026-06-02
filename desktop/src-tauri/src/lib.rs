mod commands;
mod db;
mod error;
mod features;
mod models;

use features::daily;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let pool = db::init_db(&handle).await.expect("init db");
                if let Err(e) =
                    daily::ensure_instances_for(&pool, &daily::local_today()).await
                {
                    eprintln!("ensure_instances_for(startup) failed: {e}");
                }
                handle.manage(db::AppState { pool });
            });

            let scheduler_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let wait = daily::until_next_local_midnight();
                    tokio::time::sleep(wait).await;
                    let state = scheduler_handle.state::<db::AppState>();
                    match daily::ensure_instances_for(&state.pool, &daily::local_today()).await {
                        Ok(n) => {
                            let _ = scheduler_handle.emit("daily-reset", n);
                        }
                        Err(e) => eprintln!("midnight ensure failed: {e}"),
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            features::tasks::create_task,
            features::tasks::get_task,
            features::tasks::list_tasks,
            features::tasks::update_task,
            features::tasks::archive_task,
            features::tasks::unarchive_task,
            features::daily::ensure_today_instances,
            features::daily::list_today_daily,
            features::daily::list_daily_history,
            features::daily::list_daily_history_between,
            features::daily::toggle_daily_done,
            features::daily::toggle_normal_task_today,
            features::daily::set_daily_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
