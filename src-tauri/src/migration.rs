use crate::error::AppResult;
use regex::Regex;
use std::process::Command;
use walkdir::{DirEntry, WalkDir};

// ---------- Serialized output ----------

#[derive(serde::Serialize)]
pub struct Finding {
    pub file: String,
    pub line: u32,
    pub snippet: String,
    pub cuda: String,
    pub hip: String,
    pub category: String,
    pub auto: bool,
}

#[derive(serde::Serialize)]
pub struct CategoryCount {
    pub category: String,
    pub count: u32,
}

#[derive(serde::Serialize)]
pub struct ScanReport {
    pub root: String,
    pub files_scanned: u32,
    pub findings: Vec<Finding>,
    pub by_category: Vec<CategoryCount>,
    pub capped: bool,
}

#[derive(serde::Serialize)]
pub struct HipifyStatus {
    pub available: bool,
    pub tool: String,
}

// ---------- CUDA → HIP mapping table ----------

// (cuda, hip, category, auto) — auto=true is a direct rename, false needs manual attention.
// category ∈ header | runtime | kernel | library | type | build.
const MAP: &[(&str, &str, &str, bool)] = &[
    // headers
    ("cuda_runtime.h", "hip/hip_runtime.h", "header", true),
    ("cuda.h", "hip/hip_runtime.h", "header", true),
    ("cublas_v2.h", "hipblas.h", "header", true),
    ("cublas.h", "hipblas.h", "header", true),
    ("cudnn.h", "miopen/miopen.h", "header", false),
    ("curand.h", "hiprand/hiprand.h", "header", true),
    ("cufft.h", "hipfft.h", "header", true),
    ("cusparse.h", "hipsparse.h", "header", true),
    ("device_launch_parameters.h", "hip/hip_runtime.h", "header", true),
    // runtime
    ("cudaMalloc", "hipMalloc", "runtime", true),
    ("cudaMallocManaged", "hipMallocManaged", "runtime", true),
    ("cudaFree", "hipFree", "runtime", true),
    ("cudaMemcpy", "hipMemcpy", "runtime", true),
    ("cudaMemcpyAsync", "hipMemcpyAsync", "runtime", true),
    ("cudaMemcpyHostToDevice", "hipMemcpyHostToDevice", "runtime", true),
    ("cudaMemcpyDeviceToHost", "hipMemcpyDeviceToHost", "runtime", true),
    ("cudaMemset", "hipMemset", "runtime", true),
    ("cudaDeviceSynchronize", "hipDeviceSynchronize", "runtime", true),
    ("cudaStreamCreate", "hipStreamCreate", "runtime", true),
    ("cudaStreamDestroy", "hipStreamDestroy", "runtime", true),
    ("cudaStreamSynchronize", "hipStreamSynchronize", "runtime", true),
    ("cudaEventCreate", "hipEventCreate", "runtime", true),
    ("cudaEventRecord", "hipEventRecord", "runtime", true),
    ("cudaGetLastError", "hipGetLastError", "runtime", true),
    ("cudaGetErrorString", "hipGetErrorString", "runtime", true),
    ("cudaSetDevice", "hipSetDevice", "runtime", true),
    ("cudaGetDevice", "hipGetDevice", "runtime", true),
    ("cudaGetDeviceCount", "hipGetDeviceCount", "runtime", true),
    ("cudaGetDeviceProperties", "hipGetDeviceProperties", "runtime", false),
    // types
    ("cudaStream_t", "hipStream_t", "type", true),
    ("cudaEvent_t", "hipEvent_t", "type", true),
    ("cudaError_t", "hipError_t", "type", true),
    ("cudaDeviceProp", "hipDeviceProp_t", "type", false),
    ("cudaSuccess", "hipSuccess", "type", true),
    // kernel builtins (same in HIP — flagged so users know they need no change)
    ("__syncthreads", "__syncthreads", "kernel", true),
    ("blockIdx", "blockIdx", "kernel", true),
    ("threadIdx", "threadIdx", "kernel", true),
    ("blockDim", "blockDim", "kernel", true),
    ("gridDim", "gridDim", "kernel", true),
    ("__global__", "__global__", "kernel", true),
    // libraries
    ("cublas", "hipblas", "library", false),
    ("cufft", "hipfft", "library", false),
    ("curand", "hiprand", "library", false),
    ("cusparse", "hipsparse", "library", false),
    ("thrust", "rocthrust", "library", false),
    // build
    ("nvcc", "hipcc", "build", true),
];

const SCAN_EXTS: &[&str] = &["cu", "cuh", "cpp", "cc", "cxx", "c", "h", "hpp"];
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "target", "build"];
const MAX_FINDINGS: usize = 2000;
const MAX_FILES: usize = 5000;
const SNIPPET_MAX: usize = 160;

fn compiled_map() -> Vec<(Regex, &'static (&'static str, &'static str, &'static str, bool))> {
    MAP.iter()
        .filter_map(|e| {
            // Word boundaries: every token starts and ends with a word char, so \b…\b is safe
            // even for header tokens like `cuda_runtime\.h`.
            Regex::new(&format!(r"\b{}\b", regex::escape(e.0)))
                .ok()
                .map(|re| (re, e))
        })
        .collect()
}

fn is_skipped(entry: &DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|n| SKIP_DIRS.contains(&n))
        .unwrap_or(false)
}

fn has_scan_ext(entry: &DirEntry) -> bool {
    entry
        .path()
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| SCAN_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn migrate_scan(dir: String) -> AppResult<ScanReport> {
    let map = compiled_map();
    let mut findings: Vec<Finding> = Vec::new();
    let mut files_scanned: u32 = 0;
    let mut capped = false;

    let walker = WalkDir::new(&dir)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && is_skipped(e)));

    'outer: for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() || !has_scan_ext(&entry) {
            continue;
        }
        if files_scanned as usize >= MAX_FILES {
            capped = true;
            break;
        }
        let content = match std::fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue, // skip binary/unreadable files
        };
        files_scanned += 1;

        let rel = entry
            .path()
            .strip_prefix(&dir)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();

        for (lineno, line) in content.lines().enumerate() {
            for (re, e) in &map {
                if re.is_match(line) {
                    if findings.len() >= MAX_FINDINGS {
                        capped = true;
                        break 'outer;
                    }
                    let trimmed = line.trim();
                    let snippet: String = trimmed.chars().take(SNIPPET_MAX).collect();
                    findings.push(Finding {
                        file: rel.clone(),
                        line: (lineno + 1) as u32,
                        snippet,
                        cuda: e.0.to_string(),
                        hip: e.1.to_string(),
                        category: e.2.to_string(),
                        auto: e.3,
                    });
                }
            }
        }
    }

    // Aggregate by category, preserving first-seen order.
    let mut by_category: Vec<CategoryCount> = Vec::new();
    for f in &findings {
        match by_category.iter_mut().find(|c| c.category == f.category) {
            Some(c) => c.count += 1,
            None => by_category.push(CategoryCount { category: f.category.clone(), count: 1 }),
        }
    }

    Ok(ScanReport { root: dir, files_scanned, findings, by_category, capped })
}

#[tauri::command]
pub fn migrate_hipify_available() -> HipifyStatus {
    for tool in ["hipify-perl", "hipify-clang"] {
        if crate::rocm::which(tool).is_some() {
            return HipifyStatus { available: true, tool: tool.to_string() };
        }
    }
    HipifyStatus { available: false, tool: String::new() }
}

#[tauri::command]
pub fn migrate_hipify(path: String) -> AppResult<String> {
    if crate::rocm::which("hipify-perl").is_none() {
        return Err("hipify-perl not found — install ROCm to enable conversion".into());
    }
    // Dry-run: hipify-perl writes the translated source to stdout; the file is untouched.
    let out = Command::new("hipify-perl").arg(&path).output()?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string().into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_and_maps_cuda_tokens() {
        let dir = std::env::temp_dir().join(format!("m11_scan_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = "#include <cuda_runtime.h>\n\
                   void run() {\n\
                       float* d;\n\
                       cudaMalloc(&d, 16);\n\
                       cudaMemcpy(d, h, 16, cudaMemcpyHostToDevice);\n\
                       cudaFree(d);\n\
                   }\n";
        std::fs::write(dir.join("kernel.cu"), src).unwrap();

        let report = migrate_scan(dir.to_string_lossy().to_string()).unwrap();
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(report.files_scanned, 1);
        assert!(!report.capped);

        // cudaMalloc → hipMalloc, runtime category, auto rename.
        let malloc = report.findings.iter().find(|f| f.cuda == "cudaMalloc").expect("cudaMalloc finding");
        assert_eq!(malloc.hip, "hipMalloc");
        assert_eq!(malloc.category, "runtime");
        assert!(malloc.auto);
        assert_eq!(malloc.line, 4);

        // Header mapping (regex handles the escaped dot).
        let hdr = report.findings.iter().find(|f| f.cuda == "cuda_runtime.h").expect("header finding");
        assert_eq!(hdr.hip, "hip/hip_runtime.h");
        assert_eq!(hdr.category, "header");

        // cudaMemcpyHostToDevice must not be swallowed by the cudaMemcpy match.
        assert!(report.findings.iter().any(|f| f.cuda == "cudaMemcpyHostToDevice"));

        // Category aggregation is populated.
        let runtime = report.by_category.iter().find(|c| c.category == "runtime").unwrap();
        assert!(runtime.count >= 3); // cudaMalloc, cudaMemcpy, cudaMemcpyHostToDevice, cudaFree
    }

    #[test]
    fn word_boundaries_avoid_substring_hits() {
        // `mycudaMallocWrapper` should NOT match cudaMalloc.
        let map = compiled_map();
        let (re, _) = map.iter().find(|(_, e)| e.0 == "cudaMalloc").unwrap();
        assert!(re.is_match("  cudaMalloc(&p, n);"));
        assert!(!re.is_match("mycudaMallocWrapper();"));
    }
}
