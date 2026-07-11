use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
    pub arch: String,
    pub driver: String,
    pub vram_total_mb: u64,
    pub backend: String, // "rocm-smi" | "wmi" | "amdgpu-sysfs" | "mock"
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GpuMetrics {
    pub ts: i64,
    pub load_pct: f32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub temp_c: f32,
    pub fan_pct: f32,
    pub power_w: f32,
    pub clock_mhz: f32,
}

pub fn detect_gpu() -> GpuInfo {
    if let Some(g) = try_rocm_smi_info() {
        return g;
    }
    #[cfg(target_os = "linux")]
    if let Some(g) = try_amdgpu_sysfs() {
        return g;
    }
    #[cfg(windows)]
    if let Some(g) = try_wmi() {
        return g;
    }
    mock_gpu()
}

pub fn sample_metrics(info: &GpuInfo) -> GpuMetrics {
    let ts = chrono::Utc::now().timestamp();
    match info.backend.as_str() {
        "rocm-smi" => sample_rocm_smi(info).unwrap_or_else(|| mock_metrics(ts, info)),
        "amdgpu-sysfs" => sample_sysfs(info).unwrap_or_else(|| mock_metrics(ts, info)),
        "wmi" => sample_windows(info).unwrap_or_else(|| mock_metrics(ts, info)),
        _ => mock_metrics(ts, info),
    }
}

// -------- rocm-smi --------

fn try_rocm_smi_info() -> Option<GpuInfo> {
    let out = Command::new("rocm-smi")
        .args([
            "--showproductname",
            "--showmeminfo", "vram",
            "--showdriverversion",
            "--json",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let card = json
        .as_object()?
        .iter()
        .find(|(k, _)| k.starts_with("card"))
        .map(|(_, v)| v)?;

    let name = card
        .get("Card series")
        .or_else(|| card.get("Card model"))
        .or_else(|| card.get("Card SKU"))
        .and_then(|v| v.as_str())
        .unwrap_or("AMD GPU")
        .to_string();

    let vram_total_mb = card
        .get("VRAM Total Memory (B)")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|b| b / 1024 / 1024)
        .unwrap_or(0);

    let driver = json
        .get("system")
        .and_then(|s| s.get("Driver version"))
        .and_then(|v| v.as_str())
        .unwrap_or("—")
        .to_string();

    Some(GpuInfo {
        name,
        vendor: "AMD".into(),
        arch: infer_arch(""),
        driver,
        vram_total_mb,
        backend: "rocm-smi".into(),
    })
}

fn sample_rocm_smi(info: &GpuInfo) -> Option<GpuMetrics> {
    let out = Command::new("rocm-smi")
        .args([
            "--showuse",
            "--showmemuse",
            "--showmeminfo", "vram",
            "--showtemp",
            "--showpower",
            "--showclocks",
            "--showfan",
            "--json",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let card = json
        .as_object()?
        .iter()
        .find(|(k, _)| k.starts_with("card"))
        .map(|(_, v)| v)?;

    let get_f = |k: &str| -> f32 {
        card.get(k)
            .and_then(|v| v.as_str())
            .and_then(|s| {
                s.trim()
                    .trim_end_matches('%')
                    .trim_end_matches('c')
                    .trim_end_matches('W')
                    .parse::<f32>()
                    .ok()
            })
            .unwrap_or(0.0)
    };
    let load = get_f("GPU use (%)");
    let temp = get_f("Temperature (Sensor edge) (C)")
        .max(get_f("Temperature (Sensor junction) (C)"));
    let power = get_f("Average Graphics Package Power (W)");
    let fan = get_f("Fan speed (%)");
    let clock = get_f("sclk clock speed:");

    let vram_used_mb = card
        .get("VRAM Total Used Memory (B)")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|b| b / 1024 / 1024)
        .unwrap_or(0);

    Some(GpuMetrics {
        ts: chrono::Utc::now().timestamp(),
        load_pct: load,
        vram_used_mb,
        vram_total_mb: info.vram_total_mb,
        temp_c: temp,
        fan_pct: fan,
        power_w: power,
        clock_mhz: clock,
    })
}

// -------- Linux sysfs fallback --------

/// Locate the amdgpu DRM device dir (…/cardN/device) for the first AMD card.
/// The card index is NOT fixed — an iGPU is often card1/card2 (a discrete
/// NVIDIA/other card, or the boot console, can take card0), so we scan by PCI
/// vendor (0x1002 = AMD) rather than assuming card0. Detection AND sampling
/// both route through this so they always agree on the same device.
#[cfg(target_os = "linux")]
fn amd_drm_device() -> Option<std::path::PathBuf> {
    use std::fs;
    for e in fs::read_dir("/sys/class/drm").ok()?.flatten() {
        let p = e.path();
        let name = p.file_name()?.to_string_lossy().to_string();
        if !name.starts_with("card") || name.contains('-') { continue; } // skip connectors
        let device = p.join("device");
        if fs::read_to_string(device.join("vendor"))
            .map(|v| v.trim().eq_ignore_ascii_case("0x1002"))
            .unwrap_or(false)
        {
            return Some(device);
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn try_amdgpu_sysfs() -> Option<GpuInfo> {
    use std::fs;
    let device = amd_drm_device()?;
    let model = fs::read_to_string(device.join("product_name"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let vram_total = fs::read_to_string(device.join("mem_info_vram_total"))
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|b| b / 1024 / 1024)
        .unwrap_or(0);
    Some(GpuInfo {
        name: if model.is_empty() { "AMD GPU (integrated)".into() } else { model },
        vendor: "AMD".into(),
        arch: String::new(),
        driver: "amdgpu".into(),
        vram_total_mb: vram_total,
        backend: "amdgpu-sysfs".into(),
    })
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
fn try_amdgpu_sysfs() -> Option<GpuInfo> { None }

#[cfg(target_os = "linux")]
fn sample_sysfs(info: &GpuInfo) -> Option<GpuMetrics> {
    use std::fs;
    let device = amd_drm_device()?;
    let read = |f: &str| fs::read_to_string(device.join(f)).ok();
    let load = read("gpu_busy_percent")
        .and_then(|s| s.trim().parse::<f32>().ok())
        .unwrap_or(0.0);
    let vram_used = read("mem_info_vram_used")
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|b| b / 1024 / 1024)
        .unwrap_or(0);
    // hwmon index isn't fixed either (hwmon0..N); take the first under the device.
    let hwmon = fs::read_dir(device.join("hwmon"))
        .ok()
        .and_then(|mut rd| rd.next())
        .and_then(|e| e.ok())
        .map(|e| e.path());
    let hw = |f: &str| hwmon.as_ref().and_then(|h| fs::read_to_string(h.join(f)).ok());
    let temp = hw("temp1_input")
        .and_then(|s| s.trim().parse::<f32>().ok())
        .map(|m| m / 1000.0)
        .unwrap_or(0.0);
    // Many iGPUs don't expose power/fan; best-effort, defaults to 0.
    let power = hw("power1_average")
        .and_then(|s| s.trim().parse::<f32>().ok())
        .map(|u| u / 1_000_000.0)
        .unwrap_or(0.0);
    let fan = hw("fan1_input")
        .and_then(|s| s.trim().parse::<f32>().ok())
        .unwrap_or(0.0);
    Some(GpuMetrics {
        ts: chrono::Utc::now().timestamp(),
        load_pct: load,
        vram_used_mb: vram_used,
        vram_total_mb: info.vram_total_mb,
        temp_c: temp,
        fan_pct: fan,
        power_w: power,
        clock_mhz: 0.0,
    })
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
fn sample_sysfs(_: &GpuInfo) -> Option<GpuMetrics> { None }

// -------- Windows WMI --------

#[cfg(windows)]
fn try_wmi() -> Option<GpuInfo> {
    use wmi::{COMLibrary, WMIConnection};
    use std::collections::HashMap;
    let com = COMLibrary::new().ok()?;
    let wmi = WMIConnection::new(com).ok()?;
    let results: Vec<HashMap<String, wmi::Variant>> = wmi
        .raw_query("SELECT Name, AdapterRAM, DriverVersion, VideoProcessor FROM Win32_VideoController")
        .ok()?;
    let amd = results.into_iter().find(|r| {
        r.get("Name")
            .and_then(|v| if let wmi::Variant::String(s) = v { Some(s.to_lowercase()) } else { None })
            .map(|n| n.contains("amd") || n.contains("radeon"))
            .unwrap_or(false)
    });
    let row = amd.or_else(|| {
        // fall back to any GPU
        let again: Vec<HashMap<String, wmi::Variant>> = wmi
            .raw_query("SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController")
            .ok()?;
        again.into_iter().next()
    })?;
    let get_s = |k: &str| -> String {
        if let Some(wmi::Variant::String(s)) = row.get(k) { s.clone() } else { String::new() }
    };
    let vram_total_mb = match row.get("AdapterRAM") {
        Some(wmi::Variant::UI4(n)) => (*n as u64) / 1024 / 1024,
        Some(wmi::Variant::UI8(n)) => *n / 1024 / 1024,
        _ => 0,
    };
    let name = get_s("Name");
    let driver = get_s("DriverVersion");
    let vendor = if name.to_lowercase().contains("amd") || name.to_lowercase().contains("radeon") {
        "AMD".to_string()
    } else if name.to_lowercase().contains("nvidia") {
        "NVIDIA".to_string()
    } else {
        "Unknown".to_string()
    };
    Some(GpuInfo {
        arch: infer_arch(&name),
        name,
        vendor,
        driver,
        vram_total_mb,
        backend: "wmi".into(),
    })
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn try_wmi() -> Option<GpuInfo> { None }

#[cfg(windows)]
fn sample_windows(info: &GpuInfo) -> Option<GpuMetrics> {
    // Windows performance counters for GPU engine utilization.
    // Best-effort: use PowerShell to read perf counters.
    let ps = r#"
        $counters = Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction SilentlyContinue
        if ($counters) {
            $sum = ($counters.CounterSamples | Measure-Object CookedValue -Sum).Sum
            Write-Output ([math]::Min(100, [math]::Round($sum, 1)))
        } else { Write-Output 0 }
    "#;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", ps])
        .output()
        .ok()?;
    let load = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f32>()
        .unwrap_or(0.0);
    Some(GpuMetrics {
        ts: chrono::Utc::now().timestamp(),
        load_pct: load,
        vram_used_mb: 0,
        vram_total_mb: info.vram_total_mb,
        temp_c: 0.0,
        fan_pct: 0.0,
        power_w: 0.0,
        clock_mhz: 0.0,
    })
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn sample_windows(_: &GpuInfo) -> Option<GpuMetrics> { None }

// -------- helpers --------

fn infer_arch(name: &str) -> String {
    let n = name.to_lowercase();
    if n.contains("7900") || n.contains("7800") || n.contains("7700") { "GFX1100 · RDNA 3".into() }
    else if n.contains("6900") || n.contains("6800") || n.contains("6700") { "GFX1030 · RDNA 2".into() }
    else if n.contains("mi300") { "GFX942 · CDNA 3".into() }
    else if n.contains("mi250") || n.contains("mi210") { "GFX90A · CDNA 2".into() }
    else { String::new() }
}

fn mock_gpu() -> GpuInfo {
    GpuInfo {
        name: "AMD Radeon RX 7900 XTX (simulated)".into(),
        vendor: "AMD".into(),
        arch: "GFX1100 · RDNA 3".into(),
        driver: "—".into(),
        vram_total_mb: 24576,
        backend: "mock".into(),
    }
}

fn mock_metrics(ts: i64, info: &GpuInfo) -> GpuMetrics {
    // Deterministic-ish wave for nice demo charts when no GPU is detectable.
    let phase = (ts % 60) as f32;
    let load = 55.0 + (phase * 0.10473).sin() * 25.0 + (ts as f32 * 0.7).sin() * 5.0;
    let load = load.clamp(0.0, 100.0);
    let vram_used = ((info.vram_total_mb as f32) * (0.35 + (phase * 0.02).sin() * 0.10)) as u64;
    GpuMetrics {
        ts,
        load_pct: load.round(),
        vram_used_mb: vram_used,
        vram_total_mb: info.vram_total_mb.max(24576),
        temp_c: 62.0 + load / 4.0,
        fan_pct: 30.0 + load / 3.0,
        power_w: 180.0 + load * 1.4,
        clock_mhz: 2200.0 + load * 4.0,
    }
}
