use crate::error::AppResult;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfModel {
    pub id: String,
    pub name: String,
    pub downloads: u64,
    pub likes: u64,
    pub tags: Vec<String>,
    pub pipeline: String,
    pub updated_at: String,
}

pub async fn search_hf(query: &str, limit: u32) -> AppResult<Vec<HfModel>> {
    let url = format!(
        "https://huggingface.co/api/models?search={}&limit={}&sort=downloads&direction=-1",
        urlencoding(query),
        limit.max(1).min(50)
    );
    let client = reqwest::Client::builder()
        .user_agent("rocm-forge/0.1")
        .build()?;
    let res = client.get(&url).send().await?;
    let data: Vec<serde_json::Value> = res.json().await?;
    Ok(data
        .into_iter()
        .map(|v| HfModel {
            id: v.get("id").and_then(|x| x.as_str()).unwrap_or("").into(),
            name: v.get("modelId").or_else(|| v.get("id")).and_then(|x| x.as_str()).unwrap_or("").into(),
            downloads: v.get("downloads").and_then(|x| x.as_u64()).unwrap_or(0),
            likes: v.get("likes").and_then(|x| x.as_u64()).unwrap_or(0),
            tags: v.get("tags").and_then(|x| x.as_array()).cloned().unwrap_or_default()
                .into_iter().filter_map(|t| t.as_str().map(String::from)).collect(),
            pipeline: v.get("pipeline_tag").and_then(|x| x.as_str()).unwrap_or("").into(),
            updated_at: v.get("lastModified").and_then(|x| x.as_str()).unwrap_or("").into(),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub digest: String,
    pub modified_at: String,
}

pub async fn ollama_list() -> AppResult<Vec<OllamaModel>> {
    let client = reqwest::Client::builder().build()?;
    let res = client.get("http://localhost:11434/api/tags").send().await;
    let res = match res {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };
    if !res.status().is_success() { return Ok(Vec::new()); }
    let json: serde_json::Value = res.json().await?;
    Ok(json.get("models").and_then(|m| m.as_array()).cloned().unwrap_or_default()
        .into_iter()
        .map(|m| OllamaModel {
            name: m.get("name").and_then(|x| x.as_str()).unwrap_or("").into(),
            size: m.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
            digest: m.get("digest").and_then(|x| x.as_str()).unwrap_or("").into(),
            modified_at: m.get("modified_at").and_then(|x| x.as_str()).unwrap_or("").into(),
        })
        .collect())
}

pub async fn ollama_pull(name: &str) -> AppResult<()> {
    let client = reqwest::Client::builder().build()?;
    let body = serde_json::json!({ "name": name, "stream": false });
    let res = client
        .post("http://localhost:11434/api/pull")
        .json(&body)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(format!("ollama pull failed: HTTP {}", res.status()).into());
    }
    Ok(())
}

/// Streaming pull — forwards ollama's NDJSON progress objects to the frontend
/// as `pull:progress` events (each has status/completed/total), then `pull:done`.
pub async fn ollama_pull_stream(app: &AppHandle, name: &str) -> AppResult<()> {
    let client = reqwest::Client::builder().build()?;
    let body = serde_json::json!({ "name": name, "stream": true });
    let res = client
        .post("http://localhost:11434/api/pull")
        .json(&body)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(format!("ollama pull failed: HTTP {}", res.status()).into());
    }
    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    // Response is newline-delimited JSON; a chunk may split a line, so buffer.
    while let Some(chunk) = stream.next().await {
        buf.push_str(&String::from_utf8_lossy(&chunk?));
        while let Some(nl) = buf.find('\n') {
            let line: String = buf.drain(..=nl).collect();
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                    return Err(err.to_string().into());
                }
                let _ = app.emit("pull:progress", &v);
            }
        }
    }
    let _ = app.emit("pull:done", name);
    Ok(())
}

pub async fn ollama_delete(name: &str) -> AppResult<()> {
    let client = reqwest::Client::builder().build()?;
    let body = serde_json::json!({ "name": name });
    let res = client
        .delete("http://localhost:11434/api/delete")
        .json(&body)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(format!("ollama delete failed: HTTP {}", res.status()).into());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub model: String,
    pub message: String,
    pub tokens: u32,
    pub tps: f32,
    pub ttft_ms: f32,
    pub total_ms: f32,
}

pub async fn ollama_chat(model: &str, prompt: &str) -> AppResult<ChatResponse> {
    let t0 = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()?;
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
    });
    let res = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(format!("ollama chat failed: HTTP {}", res.status()).into());
    }
    let json: serde_json::Value = res.json().await?;
    let total_ms = t0.elapsed().as_secs_f32() * 1000.0;
    let eval_count = json.get("eval_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let eval_dur_ns = json.get("eval_duration").and_then(|v| v.as_u64()).unwrap_or(1);
    let prompt_eval_ns = json.get("prompt_eval_duration").and_then(|v| v.as_u64()).unwrap_or(0);
    let tps = if eval_dur_ns > 0 { (eval_count as f32) / (eval_dur_ns as f32 / 1e9) } else { 0.0 };
    let ttft_ms = prompt_eval_ns as f32 / 1e6;
    let message = json.get("response").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(ChatResponse {
        model: model.into(),
        message,
        tokens: eval_count,
        tps,
        ttft_ms,
        total_ms,
    })
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}
