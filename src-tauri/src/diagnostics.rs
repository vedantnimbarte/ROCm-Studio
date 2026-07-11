use crate::error::AppResult;
use crate::{ai_stack, environments, gpu, rocm, system};
use std::io::Write;
use std::process::Command;

#[derive(serde::Serialize)]
pub struct DiagSection {
    pub name: String,
    pub detail: String,
    pub ok: bool,
}

#[derive(serde::Serialize)]
pub struct DiagPreview {
    pub sections: Vec<DiagSection>,
    pub estimated_files: u32,
}

fn section(name: &str, detail: impl Into<String>, ok: bool) -> DiagSection {
    DiagSection { name: name.into(), detail: detail.into(), ok }
}

// Where the running app keeps its SQLite metrics history. We can't reach the
// Tauri AppHandle from a plain command, so mirror Tauri's app_data_dir layout
// ({data_dir}/{identifier}). ponytail: keep in sync if the identifier changes.
fn metrics_db_path() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|d| d.join("com.rocmforge.app").join("forge.sqlite"))
}

#[tauri::command]
pub fn diag_preview() -> DiagPreview {
    let info = gpu::detect_gpu();
    let rocm = rocm::detect();
    let envs = environments::list_envs();
    let stack = ai_stack::detect_all();
    let stack_installed = stack.iter().filter(|s| s.installed).count();
    let db = metrics_db_path();

    let sections = vec![
        section("System", format!("{} · {}", info_or(&system::collect().os_name), system::collect().kernel), true),
        section("GPU", if info.name.is_empty() { "—".into() } else { info.name.clone() }, info.backend != "mock"),
        section("ROCm", if rocm.installed { rocm.rocm_version.clone() } else { "not installed".into() }, rocm.installed),
        section("Environments", format!("{} detected", envs.len()), !envs.is_empty()),
        section("AI Stack", format!("{} of {} installed", stack_installed, stack.len()), stack_installed > 0),
        section("rocminfo", tool_state("rocminfo"), rocm::which("rocminfo").is_some()),
        section("rocm-smi", tool_state("rocm-smi"), rocm::which("rocm-smi").is_some()),
        section(
            "GPU metrics (SQLite)",
            match &db {
                Some(p) if p.exists() => p.to_string_lossy().to_string(),
                _ => "no history db yet".into(),
            },
            db.as_ref().map(|p| p.exists()).unwrap_or(false),
        ),
        section("Environment variables", "ROCm/HIP/PATH-relevant only", true),
    ];

    DiagPreview { sections, estimated_files: 11 }
}

#[tauri::command]
pub fn diag_bundle(dest: String) -> AppResult<String> {
    let info = gpu::detect_gpu();
    let file = std::fs::File::create(&dest)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();

    let mut add = |name: &str, bytes: &[u8]| -> AppResult<()> {
        zip.start_file(name, opts)?;
        zip.write_all(bytes)?;
        Ok(())
    };

    // Structured sources as pretty JSON.
    add("system.txt", serde_json::to_string_pretty(&system::collect())?.as_bytes())?;
    add("gpu.txt", serde_json::to_string_pretty(&info)?.as_bytes())?;
    add("metrics.txt", serde_json::to_string_pretty(&gpu::sample_metrics(&info))?.as_bytes())?;
    add("rocm.txt", serde_json::to_string_pretty(&rocm::detect())?.as_bytes())?;
    add("environments.txt", serde_json::to_string_pretty(&environments::list_envs())?.as_bytes())?;
    add("ai_stack.txt", serde_json::to_string_pretty(&ai_stack::detect_all())?.as_bytes())?;
    add("env-vars.txt", env_vars_report().as_bytes())?;

    // Best-effort command outputs. Missing tools degrade to "not available".
    add("rocminfo.txt", cmd_output("rocminfo", &[]).as_bytes())?;
    add("rocm-smi.txt", cmd_output("rocm-smi", &["--showallinfo"]).as_bytes())?;
    add("hipconfig.txt", cmd_output("hipconfig", &["--full"]).as_bytes())?;
    add("uname.txt", cmd_output(if cfg!(windows) { "cmd" } else { "uname" },
        if cfg!(windows) { &["/c", "ver"] } else { &["-a"] }).as_bytes())?;

    zip.finish()?;
    Ok(dest)
}

// Only ROCm/HIP/PATH-relevant vars — never dump the full env (avoid leaking
// tokens/secrets). Filter to keys mentioning known GPU-toolchain markers.
fn env_vars_report() -> String {
    const MARKERS: [&str; 8] = ["ROCM", "HIP", "HSA", "GPU", "PATH", "CUDA", "LD_LIBRARY", "PYTHON"];
    let mut lines: Vec<String> = std::env::vars()
        .filter(|(k, _)| {
            let up = k.to_uppercase();
            MARKERS.iter().any(|m| up.contains(m))
        })
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    lines.sort();
    if lines.is_empty() {
        "no ROCm/HIP/PATH-relevant environment variables found".into()
    } else {
        lines.join("\n")
    }
}

fn cmd_output(prog: &str, args: &[&str]) -> String {
    match Command::new(prog).args(args).output() {
        Ok(o) => {
            let mut s = String::from_utf8_lossy(&o.stdout).to_string();
            let err = String::from_utf8_lossy(&o.stderr);
            if !err.trim().is_empty() {
                s.push_str("\n[stderr]\n");
                s.push_str(&err);
            }
            if s.trim().is_empty() { format!("<{prog}> produced no output") } else { s }
        }
        Err(_) => format!("<{prog}> not available"),
    }
}

fn tool_state(prog: &str) -> String {
    match rocm::which(prog) {
        Some(p) if !p.is_empty() => p,
        _ => "not found".into(),
    }
}

fn info_or(s: &str) -> String {
    if s.is_empty() { "—".into() } else { s.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_lists_sections() {
        let p = diag_preview();
        assert!(!p.sections.is_empty());
        assert!(p.estimated_files > 0);
    }

    #[test]
    fn env_vars_never_empty_string() {
        // PATH is essentially always present, so the report is non-empty.
        assert!(!env_vars_report().is_empty());
    }

    #[test]
    fn bundle_produces_valid_zip() {
        let dest = std::env::temp_dir().join("rocm-forge-diag-test.zip");
        let out = diag_bundle(dest.to_string_lossy().to_string()).expect("bundle build");
        let path = std::path::PathBuf::from(&out);
        assert!(path.exists(), "zip file should exist");

        let f = std::fs::File::open(&path).expect("open zip");
        assert!(f.metadata().unwrap().len() > 0, "zip should be non-empty");

        let mut archive = zip::ZipArchive::new(f).expect("valid zip archive");
        assert!(archive.len() > 0, "zip should contain files");
        // Spot-check that a known entry is readable.
        assert!(archive.by_name("system.txt").is_ok(), "system.txt present");

        let _ = std::fs::remove_file(&path);
    }
}
