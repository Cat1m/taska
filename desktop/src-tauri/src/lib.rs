mod commands;
mod daily;
mod db;
mod error;
mod models;
mod spawned;
mod tasks;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let pool = db::init_db(&handle).await.expect("init db");
                // Ensure today's instances at startup.
                if let Err(e) =
                    daily::ensure_instances_for(&pool, &daily::local_today()).await
                {
                    eprintln!("ensure_instances_for(startup) failed: {e}");
                }
                handle.manage(db::AppState { pool });
            });

            // Schedule a midnight reset loop in the Tauri async runtime.
            let scheduler_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let wait = daily::until_next_local_midnight();
                    tokio::time::sleep(wait).await;
                    let state = scheduler_handle.state::<db::AppState>();
                    match daily::ensure_instances_for(&state.pool, &daily::local_today())
                        .await
                    {
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
            tasks::create_task,
            tasks::get_task,
            tasks::list_tasks,
            tasks::update_task,
            tasks::archive_task,
            tasks::unarchive_task,
            daily::ensure_today_instances,
            daily::list_today_daily,
            daily::list_daily_history,
            daily::list_daily_history_between,
            daily::toggle_daily_done,
            daily::toggle_normal_task_today,
            daily::set_daily_note,
            spawned::spawn_task,
            spawned::list_spawned,
            spawned::toggle_spawned_done,
            spawned::update_spawned,
            spawned::delete_spawned,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
