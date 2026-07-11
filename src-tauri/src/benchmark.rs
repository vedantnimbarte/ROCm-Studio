use crate::error::AppResult;
use crate::models;
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchResult {
    pub id: i64,
    pub ts: i64,
    pub kind: String,
    pub model: String,
    pub backend: String,
    pub prefill_tps: Option<f32>,
    pub decode_tps: Option<f32>,
    pub ttft_ms: Option<f32>,
    pub tokens: Option<u32>,
}

const PROMPT: &str = "Explain in one paragraph how matrix multiplication on a GPU benefits from \
                      shared memory tiling, then describe how this maps to AMD RDNA 3's CU architecture.";

pub async fn run_llm(state: &State<'_, AppState>, model: &str) -> AppResult<BenchResult> {
    let chat = models::ollama_chat(model, PROMPT).await?;
    let ts = chrono::Utc::now().timestamp();
    let id = {
        let conn = state.db.lock().map_err(|_| "database lock poisoned")?;
        conn.execute(
            "INSERT INTO benchmarks
             (ts, kind, model, backend, prefill_tps, decode_tps, ttft_ms, tokens, metadata)
             VALUES (?,?,?,?,?,?,?,?,?)",
            params![
                ts,
                "llm",
                model,
                "ollama",
                None::<f64>,
                chat.tps as f64,
                chat.ttft_ms as f64,
                chat.tokens as i64,
                serde_json::json!({ "total_ms": chat.total_ms }).to_string(),
            ],
        )?;
        conn.last_insert_rowid()
    };
    Ok(BenchResult {
        id,
        ts,
        kind: "llm".into(),
        model: model.into(),
        backend: "ollama".into(),
        prefill_tps: None,
        decode_tps: Some(chat.tps),
        ttft_ms: Some(chat.ttft_ms),
        tokens: Some(chat.tokens),
    })
}

pub fn history(state: &State<'_, AppState>) -> AppResult<Vec<BenchResult>> {
    let conn = state.db.lock().map_err(|_| "database lock poisoned")?;
    let mut stmt = conn.prepare(
        "SELECT id, ts, kind, model, COALESCE(backend, ''), prefill_tps, decode_tps, ttft_ms, tokens
         FROM benchmarks ORDER BY ts DESC LIMIT 50"
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(BenchResult {
            id: r.get(0)?,
            ts: r.get(1)?,
            kind: r.get(2)?,
            model: r.get(3)?,
            backend: r.get(4)?,
            prefill_tps: r.get::<_, Option<f64>>(5)?.map(|v| v as f32),
            decode_tps: r.get::<_, Option<f64>>(6)?.map(|v| v as f32),
            ttft_ms: r.get::<_, Option<f64>>(7)?.map(|v| v as f32),
            tokens: r.get::<_, Option<i64>>(8)?.map(|v| v as u32),
        })
    })?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}
