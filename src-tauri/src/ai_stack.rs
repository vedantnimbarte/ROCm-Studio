use crate::rocm::which;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub installed: bool,
    pub install_hint: String,
    pub docs_url: String,
}

pub fn detect_all() -> Vec<StackItem> {
    vec![
        item("pytorch", "PyTorch ROCm",
             python_module_version("torch"),
             "pip install torch --index-url https://download.pytorch.org/whl/rocm6.2",
             "https://pytorch.org/get-started/locally/"),
        item("tensorflow", "TensorFlow ROCm",
             python_module_version("tensorflow"),
             "pip install tensorflow-rocm",
             "https://www.tensorflow.org/install"),
        item("ollama", "Ollama",
             cli_version("ollama", &["--version"]),
             "Download the installer from https://ollama.com/download",
             "https://ollama.com/download"),
        item("vllm", "vLLM",
             python_module_version("vllm"),
             "pip install vllm",
             "https://docs.vllm.ai"),
        item("llamacpp", "llama.cpp",
             cli_version("llama-cli", &["--version"]),
             "git clone https://github.com/ggerganov/llama.cpp && make HIP=1",
             "https://github.com/ggerganov/llama.cpp"),
        item("openwebui", "Open WebUI",
             python_module_version("open_webui"),
             "pip install open-webui",
             "https://openwebui.com"),
        item("comfyui", "ComfyUI",
             check_path_exists(&[".comfyui", "ComfyUI"]),
             "git clone https://github.com/comfyanonymous/ComfyUI",
             "https://github.com/comfyanonymous/ComfyUI"),
        item("jupyter", "Jupyter Lab",
             cli_version("jupyter", &["--version"]),
             "pip install jupyterlab",
             "https://jupyter.org"),
    ]
}

fn item(id: &str, name: &str, version: Option<String>, hint: &str, docs: &str) -> StackItem {
    let installed = version.is_some();
    StackItem {
        id: id.into(),
        name: name.into(),
        version: version.unwrap_or_else(|| "—".into()),
        installed,
        install_hint: hint.into(),
        docs_url: docs.into(),
    }
}

fn cli_version(cmd: &str, args: &[&str]) -> Option<String> {
    which(cmd)?;
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Some(s.lines().next().unwrap_or(&s).to_string())
}

fn python_module_version(module: &str) -> Option<String> {
    let py = if which("python3").is_some() { "python3" } else { "python" };
    let code = format!("import {m}; print({m}.__version__)", m = module);
    let out = Command::new(py).args(["-c", &code]).output().ok()?;
    if !out.status.success() { return None; }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() { None } else { Some(v) }
}

fn check_path_exists(rels: &[&str]) -> Option<String> {
    let home = dirs::home_dir()?;
    for r in rels {
        if home.join(r).exists() { return Some("found".into()); }
    }
    None
}

pub fn install_command(id: &str) -> Option<(String, Vec<String>)> {
    let (prog, args): (&str, Vec<&str>) = match id {
        "pytorch" => ("pip", vec!["install", "torch", "--index-url", "https://download.pytorch.org/whl/rocm6.2"]),
        "tensorflow" => ("pip", vec!["install", "tensorflow-rocm"]),
        "vllm" => ("pip", vec!["install", "vllm"]),
        "openwebui" => ("pip", vec!["install", "open-webui"]),
        "jupyter" => ("pip", vec!["install", "jupyterlab"]),
        _ => return None,
    };
    Some((prog.into(), args.into_iter().map(String::from).collect()))
}
