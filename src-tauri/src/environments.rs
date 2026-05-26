use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PyEnv {
    pub name: String,
    pub kind: String, // "venv" | "conda"
    pub path: String,
    pub python_version: String,
    pub packages: usize,
}

pub fn list_envs() -> Vec<PyEnv> {
    let mut out = Vec::new();
    out.extend(list_venvs());
    out.extend(list_conda());
    out
}

fn home() -> Option<PathBuf> { dirs::home_dir() }

fn list_venvs() -> Vec<PyEnv> {
    let Some(home) = home() else { return Vec::new(); };
    let roots = [
        home.join("envs"),
        home.join(".virtualenvs"),
        home.join("venvs"),
        home.join("Documents").join("envs"),
    ];
    let mut envs = Vec::new();
    for root in roots.iter().filter(|p| p.exists()) {
        if let Ok(rd) = std::fs::read_dir(root) {
            for entry in rd.flatten() {
                let path = entry.path();
                let py = python_exe(&path);
                if py.exists() {
                    let version = run_capture(&py, &["--version"]);
                    let pkgs = run_capture(&py, &["-m", "pip", "list", "--format=freeze"])
                        .lines()
                        .filter(|l| !l.trim().is_empty())
                        .count();
                    envs.push(PyEnv {
                        name: entry.file_name().to_string_lossy().to_string(),
                        kind: "venv".into(),
                        path: path.to_string_lossy().to_string(),
                        python_version: version.trim().replace("Python ", ""),
                        packages: pkgs,
                    });
                }
            }
        }
    }
    envs
}

fn list_conda() -> Vec<PyEnv> {
    let Some(out) = run_cmd("conda", &["env", "list", "--json"]) else { return Vec::new(); };
    let json: serde_json::Value = match serde_json::from_str(&out) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    json.get("envs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            let path = p.as_str()?.to_string();
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "base".into());
            let py = python_exe(std::path::Path::new(&path));
            let version = run_capture(&py, &["--version"]);
            Some(PyEnv {
                name,
                kind: "conda".into(),
                path,
                python_version: version.trim().replace("Python ", ""),
                packages: 0,
            })
        })
        .collect()
}

fn python_exe(env_root: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        let p = env_root.join("Scripts").join("python.exe");
        if p.exists() { return p; }
        env_root.join("python.exe")
    } else {
        let p = env_root.join("bin").join("python");
        if p.exists() { return p; }
        env_root.join("bin").join("python3")
    }
}

pub fn create_venv(name: &str) -> AppResult<PyEnv> {
    let home = home().ok_or("no home dir")?;
    let root = home.join("envs");
    std::fs::create_dir_all(&root)?;
    let path = root.join(name);
    if path.exists() {
        return Err(format!("env '{}' already exists", name).into());
    }
    let python = if which("python3").is_some() { "python3" } else { "python" };
    let out = Command::new(python)
        .args(["-m", "venv", path.to_string_lossy().as_ref()])
        .output()?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string().into());
    }
    let py = python_exe(&path);
    let version = run_capture(&py, &["--version"]);
    Ok(PyEnv {
        name: name.into(),
        kind: "venv".into(),
        path: path.to_string_lossy().to_string(),
        python_version: version.trim().replace("Python ", ""),
        packages: 0,
    })
}

pub fn delete_env(path: &str) -> AppResult<()> {
    let p = std::path::Path::new(path);
    if !p.exists() { return Err("env does not exist".into()); }
    std::fs::remove_dir_all(p)?;
    Ok(())
}

pub fn list_packages(env_path: &str) -> Vec<(String, String)> {
    let py = python_exe(std::path::Path::new(env_path));
    let raw = run_capture(&py, &["-m", "pip", "list", "--format=freeze"]);
    raw.lines()
        .filter_map(|l| {
            let mut it = l.splitn(2, "==");
            let n = it.next()?.trim().to_string();
            let v = it.next().unwrap_or("").trim().to_string();
            if n.is_empty() { None } else { Some((n, v)) }
        })
        .collect()
}

fn run_cmd(prog: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(prog).args(args).output().ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}
fn run_capture(prog: &std::path::Path, args: &[&str]) -> String {
    match Command::new(prog).args(args).output() {
        Ok(o) => {
            let mut s = String::from_utf8_lossy(&o.stdout).to_string();
            if s.trim().is_empty() {
                s = String::from_utf8_lossy(&o.stderr).to_string();
            }
            s
        }
        Err(_) => String::new(),
    }
}
fn which(cmd: &str) -> Option<String> { crate::rocm::which(cmd) }
