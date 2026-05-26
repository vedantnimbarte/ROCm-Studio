use crate::error::AppResult;
use rusqlite::{Connection, params};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn db_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("forge.sqlite"))
}

pub fn open(p: &PathBuf) -> AppResult<Connection> {
    let conn = Connection::open(p)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

pub fn init_schema(c: &Connection) -> AppResult<()> {
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS metrics_history (
            ts          INTEGER NOT NULL,
            gpu_load    REAL,
            vram_used   REAL,
            vram_total  REAL,
            temp_c      REAL,
            fan_pct     REAL,
            power_w     REAL,
            clock_mhz   REAL
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_history(ts);

        CREATE TABLE IF NOT EXISTS benchmarks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ts           INTEGER NOT NULL,
            kind         TEXT NOT NULL,
            model        TEXT NOT NULL,
            backend      TEXT,
            prefill_tps  REAL,
            decode_tps   REAL,
            ttft_ms      REAL,
            tokens       INTEGER,
            metadata     TEXT
        );

        CREATE TABLE IF NOT EXISTS models_cache (
            id          TEXT PRIMARY KEY,
            source      TEXT NOT NULL,
            name        TEXT NOT NULL,
            size_bytes  INTEGER,
            params      TEXT,
            quant       TEXT,
            ctx         INTEGER,
            license     TEXT,
            updated_at  INTEGER
        );
        "#,
    )?;
    Ok(())
}

pub fn prune_metrics(c: &Connection, keep_days: i64) -> AppResult<()> {
    let cutoff = chrono::Utc::now().timestamp() - keep_days * 86_400;
    c.execute("DELETE FROM metrics_history WHERE ts < ?", params![cutoff])?;
    Ok(())
}
