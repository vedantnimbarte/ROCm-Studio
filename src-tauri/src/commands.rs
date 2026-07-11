use crate::error::AppResult;
use crate::{ai_stack, benchmark, environments, gpu, models, rocm, system, AppState};
use rusqlite::params;
use serde::Serialize;
use std::process::Command;
use tauri::State;

// ===================== SYSTEM / GPU =====================

#[derive(Serialize)]
pub struct Overview {
    pub system: system::SystemInfo,
    pub gpu: gpu::GpuInfo,
    pub rocm: rocm::RocmStatus,
}

#[tauri::command]
pub fn sys_get_overview() -> Overview {
    Overview {
        system: system::collect(),
        gpu: gpu::detect_gpu(),
        rocm: rocm::detect(),
    }
}

#[tauri::command]
pub fn sys_get_metrics() -> gpu::GpuMetrics {
    let info = gpu::detect_gpu();
    gpu::sample_metrics(&info)
}

#[derive(Serialize)]
pub struct MetricsRow {
    pub ts: i64,
    pub load: f32,
    pub vram_used: f32,
    pub vram_total: f32,
    pub temp: f32,
    pub fan: f32,
    pub power: f32,
}

#[tauri::command]
pub fn sys_metrics_history(state: State<'_, AppState>, since_secs: i64) -> AppResult<Vec<MetricsRow>> {
    let cutoff = chrono::Utc::now().timestamp() - since_secs.max(60);
    let conn = state.db.lock().map_err(|_| "database lock poisoned")?;
    let mut stmt = conn.prepare(
        "SELECT ts, gpu_load, vram_used, vram_total, temp_c, fan_pct, power_w
         FROM metrics_history WHERE ts >= ? ORDER BY ts ASC"
    )?;
    let rows = stmt.query_map(params![cutoff], |r| {
        Ok(MetricsRow {
            ts: r.get(0)?,
            load: r.get::<_, f64>(1)? as f32,
            vram_used: r.get::<_, f64>(2)? as f32,
            vram_total: r.get::<_, f64>(3)? as f32,
            temp: r.get::<_, f64>(4)? as f32,
            fan: r.get::<_, f64>(5)? as f32,
            power: r.get::<_, f64>(6)? as f32,
        })
    })?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

#[tauri::command]
pub fn sys_export_metrics(state: State<'_, AppState>, dest: String, format: String) -> AppResult<String> {
    let rows = sys_metrics_history(state, 30 * 86_400)?;
    let path = std::path::PathBuf::from(&dest);
    if format == "json" {
        std::fs::write(&path, serde_json::to_string_pretty(&rows)?)?;
    } else {
        let mut s = String::from("ts,load_pct,vram_used_mb,vram_total_mb,temp_c,fan_pct,power_w\n");
        for r in rows {
            s.push_str(&format!(
                "{},{},{},{},{},{},{}\n",
                r.ts, r.load, r.vram_used, r.vram_total, r.temp, r.fan, r.power
            ));
        }
        std::fs::write(&path, s)?;
    }
    Ok(path.to_string_lossy().to_string())
}

// ===================== ROCM =====================

#[tauri::command]
pub fn rocm_detect() -> rocm::RocmStatus {
    rocm::detect()
}

#[tauri::command]
pub fn rocm_compatibility() -> rocm::CompatReport {
    let info = gpu::detect_gpu();
    let status = rocm::detect();
    rocm::compatibility(&info, &status)
}

#[derive(Serialize)]
pub struct RepairPlan {
    pub steps: Vec<String>,
    pub commands: Vec<String>,
}

#[tauri::command]
pub fn rocm_repair_dryrun() -> RepairPlan {
    let status = rocm::detect();
    let mut steps = Vec::new();
    let mut commands = Vec::new();
    if !status.installed {
        if cfg!(target_os = "linux") {
            steps.push("Install ROCm packages via apt".into());
            commands.push("sudo apt update".into());
            commands.push("sudo apt install rocm-hip-runtime rocm-libs".into());
        } else {
            steps.push("Download HIP SDK for Windows".into());
            commands.push("Start-Process https://rocm.docs.amd.com/projects/install-on-windows/".into());
        }
    } else {
        steps.push("Verify HIP installation".into());
        commands.push("hipconfig --check".into());
        steps.push("Run rocminfo to confirm GPU enumeration".into());
        commands.push("rocminfo".into());
    }
    RepairPlan { steps, commands }
}

// ===================== ENVIRONMENTS =====================

#[tauri::command]
pub fn env_list() -> Vec<environments::PyEnv> {
    environments::list_envs()
}
#[tauri::command]
pub fn env_create(name: String) -> AppResult<environments::PyEnv> {
    environments::create_venv(&name)
}
#[tauri::command]
pub fn env_delete(path: String) -> AppResult<()> {
    environments::delete_env(&path)
}
#[tauri::command]
pub fn env_packages(path: String) -> Vec<(String, String)> {
    environments::list_packages(&path)
}

// ===================== AI STACK =====================

#[tauri::command]
pub fn stack_detect() -> Vec<ai_stack::StackItem> {
    ai_stack::detect_all()
}
#[derive(Serialize)]
pub struct StackInstallResult {
    pub ok: bool,
    pub output: String,
}
#[tauri::command]
pub fn stack_install(id: String) -> StackInstallResult {
    let Some((prog, args)) = ai_stack::install_command(&id) else {
        return StackInstallResult { ok: false, output: "no install command for this item".into() };
    };
    match Command::new(&prog).args(&args).output() {
        Ok(o) => {
            let ok = o.status.success();
            let mut output = String::from_utf8_lossy(&o.stdout).to_string();
            output.push_str(&String::from_utf8_lossy(&o.stderr));
            StackInstallResult { ok, output }
        }
        Err(e) => StackInstallResult { ok: false, output: e.to_string() },
    }
}

// ===================== MODELS =====================

#[tauri::command]
pub async fn model_search_hf(query: String, limit: u32) -> AppResult<Vec<models::HfModel>> {
    models::search_hf(&query, limit).await
}

#[tauri::command]
pub async fn model_ollama_list() -> AppResult<Vec<models::OllamaModel>> {
    models::ollama_list().await
}

#[tauri::command]
pub async fn model_ollama_pull(name: String) -> AppResult<()> {
    models::ollama_pull(&name).await
}

#[tauri::command]
pub async fn model_ollama_delete(name: String) -> AppResult<()> {
    models::ollama_delete(&name).await
}

// ===================== INFERENCE =====================

#[tauri::command]
pub async fn inference_chat(model: String, prompt: String) -> AppResult<models::ChatResponse> {
    models::ollama_chat(&model, &prompt).await
}

// ===================== BENCHMARK =====================

#[tauri::command]
pub async fn bench_run_llm(state: State<'_, AppState>, model: String) -> AppResult<benchmark::BenchResult> {
    benchmark::run_llm(&state, &model).await
}
#[tauri::command]
pub fn bench_history(state: State<'_, AppState>) -> AppResult<Vec<benchmark::BenchResult>> {
    benchmark::history(&state)
}

// ===================== UTIL =====================

#[tauri::command]
pub fn open_external(url: String) -> AppResult<()> {
    let prog = if cfg!(windows) { "cmd" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let args: Vec<String> = if cfg!(windows) {
        vec!["/c".into(), "start".into(), "".into(), url]
    } else {
        vec![url]
    };
    Command::new(prog).args(&args).spawn()?;
    Ok(())
}
