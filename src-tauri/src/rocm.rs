use crate::gpu::GpuInfo;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RocmStatus {
    pub installed: bool,
    pub rocm_version: String,
    pub hip_version: String,
    pub install_path: String,
    pub source: String, // "/opt/rocm/.info/version" | "HIP_PATH" | "registry"
}

pub fn detect() -> RocmStatus {
    if let Some(s) = detect_linux() { return s; }
    if let Some(s) = detect_windows() { return s; }
    RocmStatus { installed: false, ..Default::default() }
}

fn detect_linux() -> Option<RocmStatus> {
    if cfg!(not(target_os = "linux")) { return None; }
    let version_file = "/opt/rocm/.info/version";
    let rocm_version = std::fs::read_to_string(version_file)
        .ok()
        .map(|s| s.trim().to_string());
    if let Some(v) = rocm_version {
        let hip = Command::new("/opt/rocm/bin/hipconfig")
            .arg("--version")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        return Some(RocmStatus {
            installed: true,
            rocm_version: v,
            hip_version: hip,
            install_path: "/opt/rocm".into(),
            source: version_file.into(),
        });
    }
    // Fall back to `rocminfo`.
    if let Ok(o) = Command::new("rocminfo").output() {
        if o.status.success() {
            return Some(RocmStatus {
                installed: true,
                rocm_version: "detected".into(),
                hip_version: "—".into(),
                install_path: "—".into(),
                source: "rocminfo".into(),
            });
        }
    }
    None
}

fn detect_windows() -> Option<RocmStatus> {
    if cfg!(not(target_os = "windows")) { return None; }
    let hip_path = std::env::var("HIP_PATH").ok();
    if let Some(p) = hip_path {
        let version_file = std::path::PathBuf::from(&p).join(".version");
        let ver = std::fs::read_to_string(&version_file)
            .ok()
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "HIP SDK".into());
        return Some(RocmStatus {
            installed: true,
            rocm_version: format!("HIP SDK · {}", ver),
            hip_version: ver,
            install_path: p,
            source: "HIP_PATH env".into(),
        });
    }
    // Check the typical install location.
    let default = r"C:\Program Files\AMD\ROCm";
    if std::path::Path::new(default).exists() {
        return Some(RocmStatus {
            installed: true,
            rocm_version: "HIP SDK (installed)".into(),
            hip_version: "—".into(),
            install_path: default.into(),
            source: "default path".into(),
        });
    }
    None
}

// ---------- Compatibility scan ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatCheck {
    pub id: String,
    pub label: String,
    pub status: String, // "ok" | "warn" | "fail"
    pub detail: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatReport {
    pub score: u32,
    pub checks: Vec<CompatCheck>,
}

pub fn compatibility(info: &GpuInfo, rocm: &RocmStatus) -> CompatReport {
    let mut checks = Vec::new();

    let gpu_ok = info.vendor.eq_ignore_ascii_case("AMD") && info.backend != "mock";
    checks.push(CompatCheck {
        id: "gpu".into(),
        label: "AMD GPU detected".into(),
        status: if gpu_ok { "ok" } else if info.vendor.eq_ignore_ascii_case("AMD") { "warn" } else { "fail" }.into(),
        detail: if info.name.is_empty() { "—".into() } else { info.name.clone() },
        weight: 25,
    });

    let arch_ok = !info.arch.is_empty();
    checks.push(CompatCheck {
        id: "arch".into(),
        label: "Supported architecture".into(),
        status: if arch_ok { "ok" } else { "warn" }.into(),
        detail: if arch_ok { info.arch.clone() } else { "unknown — may need overrides".into() },
        weight: 15,
    });

    // Informational (weight 0, doesn't move the score): explain up front why an
    // APU/iGPU tends to score low, instead of leaving the user to guess.
    if is_integrated_amd(info) {
        checks.push(CompatCheck {
            id: "igpu".into(),
            label: "Integrated GPU (APU)".into(),
            status: "warn".into(),
            detail: "Detected an AMD APU/iGPU. These are largely outside ROCm's official support — GPU compute may work only via HSA_OVERRIDE_GFX_VERSION, if at all. Live telemetry still works.".into(),
            weight: 0,
        });
    }

    checks.push(CompatCheck {
        id: "driver".into(),
        label: "Driver present".into(),
        status: if !info.driver.is_empty() && info.driver != "—" { "ok" } else { "warn" }.into(),
        detail: if info.driver.is_empty() { "—".into() } else { info.driver.clone() },
        weight: 15,
    });

    checks.push(CompatCheck {
        id: "rocm".into(),
        label: "ROCm / HIP runtime".into(),
        status: if rocm.installed { "ok" } else { "fail" }.into(),
        detail: if rocm.installed { rocm.rocm_version.clone() } else { "not installed".into() },
        weight: 25,
    });

    let kernel = sysinfo::System::kernel_version().unwrap_or_default();
    checks.push(CompatCheck {
        id: "kernel".into(),
        label: "Kernel / OS".into(),
        status: "ok".into(),
        detail: kernel,
        weight: 10,
    });

    let docker_ok = which("docker").is_some() || which("podman").is_some();
    checks.push(CompatCheck {
        id: "docker".into(),
        label: "Container runtime".into(),
        status: if docker_ok { "ok" } else { "warn" }.into(),
        detail: if docker_ok { "available".into() } else { "missing (optional)".into() },
        weight: 10,
    });

    let total_weight: u32 = checks.iter().map(|c| c.weight).sum();
    let got: u32 = checks.iter().map(|c| match c.status.as_str() {
        "ok"   => c.weight,
        "warn" => c.weight / 2,
        _      => 0,
    }).sum();
    let score = ((got as f32 / total_weight as f32) * 100.0).round() as u32;
    CompatReport { score, checks }
}

/// Heuristic for an AMD APU/iGPU: it carves out a small shared-memory "VRAM"
/// region (256 MB–2 GB) rather than a discrete card's dedicated 4 GB+, or the
/// detected name says "integrated". Guards against the mock backend so we only
/// flag a real detection.
fn is_integrated_amd(info: &GpuInfo) -> bool {
    info.vendor.eq_ignore_ascii_case("AMD")
        && info.backend != "mock"
        && ((info.vram_total_mb > 0 && info.vram_total_mb <= 2048)
            || info.name.to_lowercase().contains("integrated"))
}

pub fn which(cmd: &str) -> Option<String> {
    let prog = if cfg!(windows) { "where" } else { "which" };
    let out = Command::new(prog).arg(cmd).output().ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(name: &str, vram_mb: u64, backend: &str) -> GpuInfo {
        GpuInfo { name: name.into(), vendor: "AMD".into(), vram_total_mb: vram_mb, backend: backend.into(), ..Default::default() }
    }

    #[test]
    fn flags_small_vram_igpu() {
        assert!(is_integrated_amd(&gpu("AMD GPU (integrated)", 512, "amdgpu-sysfs")));
    }
    #[test]
    fn ignores_discrete_card() {
        assert!(!is_integrated_amd(&gpu("Radeon RX 6800", 16384, "rocm-smi")));
    }
    #[test]
    fn ignores_mock_and_nonamd() {
        assert!(!is_integrated_amd(&gpu("AMD GPU", 512, "mock")));
        let mut nvidia = gpu("GeForce", 512, "wmi");
        nvidia.vendor = "NVIDIA".into();
        assert!(!is_integrated_amd(&nvidia));
    }
}
