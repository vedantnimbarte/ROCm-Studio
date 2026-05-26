use crate::{gpu, AppState};
use rusqlite::params;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub fn spawn_sampler(app: AppHandle) {
    let app = Arc::new(app);
    std::thread::spawn(move || {
        // Detect once; metric sampling is what runs in a loop.
        let info = gpu::detect_gpu();
        let _ = app.emit("gpu:info", &info);

        let mut last_prune = std::time::Instant::now();
        loop {
            let m = gpu::sample_metrics(&info);
            let _ = app.emit("gpu:metrics", &m);

            // Persist to history (best effort).
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute(
                        "INSERT INTO metrics_history
                         (ts, gpu_load, vram_used, vram_total, temp_c, fan_pct, power_w, clock_mhz)
                         VALUES (?,?,?,?,?,?,?,?)",
                        params![
                            m.ts,
                            m.load_pct as f64,
                            m.vram_used_mb as f64,
                            m.vram_total_mb as f64,
                            m.temp_c as f64,
                            m.fan_pct as f64,
                            m.power_w as f64,
                            m.clock_mhz as f64,
                        ],
                    );
                    if last_prune.elapsed().as_secs() > 3600 {
                        let _ = crate::db::prune_metrics(&conn, 30);
                        last_prune = std::time::Instant::now();
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    });
}
