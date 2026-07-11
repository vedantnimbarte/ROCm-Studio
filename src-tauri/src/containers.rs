use crate::error::AppResult;
use std::process::Command;

// ===================== TYPES (frontend contract, snake_case) =====================

#[derive(serde::Serialize)]
pub struct RuntimeInfo {
    pub docker: bool,
    pub podman: bool,
    pub active: String,
    pub version: String,
}

#[derive(serde::Serialize)]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub rocm: bool,
}

#[derive(serde::Serialize)]
pub struct ContainerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub rocm: bool,
}

// ===================== RUNTIME DETECTION =====================

/// Pick the active runtime: docker first, else podman (CLI-compatible), else none.
fn active_runtime() -> Option<String> {
    if crate::rocm::which("docker").is_some() {
        Some("docker".into())
    } else if crate::rocm::which("podman").is_some() {
        Some("podman".into())
    } else {
        None
    }
}

fn combined(out: &std::process::Output) -> String {
    let mut s = String::from_utf8_lossy(&out.stdout).to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !s.is_empty() { s.push('\n'); }
        s.push_str(&err);
    }
    s.trim().to_string()
}

// ===================== PURE PARSING (testable without docker) =====================

/// Best-effort heuristic: an image is ROCm-enabled if its name mentions rocm.
/// Covers rocm/*, *pytorch*rocm*, *tensorflow*rocm*, etc. ponytail: name-only
/// heuristic — swap in a `docker inspect` device check if false negatives matter.
fn is_rocm_image(name: &str) -> bool {
    name.to_ascii_lowercase().contains("rocm")
}

#[derive(serde::Deserialize)]
struct PsLine {
    #[serde(rename = "ID", default)] id: String,
    #[serde(rename = "Names", default)] names: String,
    #[serde(rename = "Image", default)] image: String,
    #[serde(rename = "Status", default)] status: String,
    #[serde(rename = "State", default)] state: String,
    #[serde(rename = "Ports", default)] ports: String,
}

fn parse_container_line(line: &str) -> Option<Container> {
    let l = line.trim();
    if l.is_empty() { return None; }
    let p: PsLine = serde_json::from_str(l).ok()?;
    Some(Container {
        rocm: is_rocm_image(&p.image),
        id: p.id,
        name: p.names,
        image: p.image,
        status: p.status,
        state: p.state,
        ports: p.ports,
    })
}

#[derive(serde::Deserialize)]
struct ImgLine {
    #[serde(rename = "ID", default)] id: String,
    #[serde(rename = "Repository", default)] repository: String,
    #[serde(rename = "Tag", default)] tag: String,
    #[serde(rename = "Size", default)] size: String,
}

fn parse_image_line(line: &str) -> Option<ContainerImage> {
    let l = line.trim();
    if l.is_empty() { return None; }
    let p: ImgLine = serde_json::from_str(l).ok()?;
    Some(ContainerImage {
        rocm: is_rocm_image(&format!("{}:{}", p.repository, p.tag)),
        id: p.id,
        repository: p.repository,
        tag: p.tag,
        size: p.size,
    })
}

const ACTIONS: [&str; 4] = ["start", "stop", "restart", "rm"];

/// Reject anything not in the allowlist — never pass arbitrary strings to the shell.
fn validate_action(action: &str) -> AppResult<()> {
    if ACTIONS.contains(&action) {
        Ok(())
    } else {
        Err(format!("invalid action '{}'", action).into())
    }
}

// ===================== COMMANDS =====================

#[tauri::command]
pub fn container_runtime() -> RuntimeInfo {
    let docker = crate::rocm::which("docker").is_some();
    let podman = crate::rocm::which("podman").is_some();
    let active = if docker { "docker" } else if podman { "podman" } else { "" };
    let version = if active.is_empty() {
        String::new()
    } else {
        Command::new(active)
            .arg("--version")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    RuntimeInfo { docker, podman, active: active.into(), version }
}

#[tauri::command]
pub fn container_ps() -> AppResult<Vec<Container>> {
    let Some(rt) = active_runtime() else { return Ok(Vec::new()); };
    let out = Command::new(&rt)
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(parse_container_line)
        .collect())
}

#[tauri::command]
pub fn container_images() -> AppResult<Vec<ContainerImage>> {
    let Some(rt) = active_runtime() else { return Ok(Vec::new()); };
    let out = Command::new(&rt)
        .args(["images", "--format", "{{json .}}"])
        .output()?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(parse_image_line)
        .collect())
}

#[tauri::command]
pub fn container_action(action: String, id: String) -> AppResult<String> {
    validate_action(&action)?;
    if id.trim().is_empty() { return Err("container id required".into()); }
    let rt = active_runtime().ok_or("no container runtime (docker/podman) found")?;
    let mut args: Vec<&str> = if action == "rm" { vec!["rm", "-f"] } else { vec![action.as_str()] };
    args.push(id.trim());
    let out = Command::new(&rt).args(&args).output()?;
    Ok(combined(&out))
}

#[tauri::command]
pub fn container_pull(image: String) -> AppResult<String> {
    if image.trim().is_empty() { return Err("image name required".into()); }
    let rt = active_runtime().ok_or("no container runtime (docker/podman) found")?;
    let out = Command::new(&rt).args(["pull", image.trim()]).output()?;
    Ok(combined(&out))
}

// ===================== TESTS (daemon-independent) =====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_container_line() {
        let line = r#"{"ID":"abc123","Names":"torch-dev","Image":"rocm/pytorch:latest","Status":"Up 3 minutes","State":"running","Ports":"0.0.0.0:8888->8888/tcp"}"#;
        let c = parse_container_line(line).expect("should parse");
        assert_eq!(c.id, "abc123");
        assert_eq!(c.name, "torch-dev");
        assert_eq!(c.image, "rocm/pytorch:latest");
        assert_eq!(c.state, "running");
        assert_eq!(c.ports, "0.0.0.0:8888->8888/tcp");
        assert!(c.rocm);
    }

    #[test]
    fn skips_blank_and_garbage_lines() {
        assert!(parse_container_line("   ").is_none());
        assert!(parse_container_line("not json").is_none());
    }

    #[test]
    fn parses_image_line() {
        let line = r#"{"ID":"deadbeef","Repository":"ubuntu","Tag":"22.04","Size":"77.8MB"}"#;
        let img = parse_image_line(line).expect("should parse");
        assert_eq!(img.repository, "ubuntu");
        assert_eq!(img.tag, "22.04");
        assert_eq!(img.size, "77.8MB");
        assert!(!img.rocm);
    }

    #[test]
    fn rocm_heuristic() {
        assert!(is_rocm_image("rocm/pytorch"));
        assert!(is_rocm_image("ROCm/tensorflow:latest"));
        assert!(!is_rocm_image("ubuntu"));
        assert!(!is_rocm_image("nvidia/cuda"));
    }

    #[test]
    fn action_allowlist() {
        for a in ["start", "stop", "restart", "rm"] {
            assert!(validate_action(a).is_ok());
        }
        assert!(validate_action("exec").is_err());
        assert!(validate_action("rm -rf /").is_err());
        assert!(validate_action("").is_err());
    }
}
