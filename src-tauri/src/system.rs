use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub kernel: String,
    pub hostname: String,
    pub cpu: String,
    pub cpu_cores: usize,
    pub total_mem_mb: u64,
    pub used_mem_mb: u64,
}

pub fn collect() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".into());

    SystemInfo {
        os_name: System::name().unwrap_or_else(|| "Unknown".into()),
        os_version: System::os_version().unwrap_or_else(|| "—".into()),
        kernel: System::kernel_version().unwrap_or_else(|| "—".into()),
        hostname: System::host_name().unwrap_or_else(|| "—".into()),
        cpu,
        cpu_cores: sys.cpus().len(),
        total_mem_mb: sys.total_memory() / 1024 / 1024,
        used_mem_mb: sys.used_memory() / 1024 / 1024,
    }
}
