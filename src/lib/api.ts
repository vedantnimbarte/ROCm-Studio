import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ---------- Types ----------
export interface SystemInfo {
  os_name: string; os_version: string; kernel: string; hostname: string;
  cpu: string; cpu_cores: number; total_mem_mb: number; used_mem_mb: number;
}
export interface GpuInfo {
  name: string; vendor: string; arch: string; driver: string;
  vram_total_mb: number; backend: string;
}
export interface GpuMetrics {
  ts: number; load_pct: number; vram_used_mb: number; vram_total_mb: number;
  temp_c: number; fan_pct: number; power_w: number; clock_mhz: number;
}
export interface RocmStatus {
  installed: boolean; rocm_version: string; hip_version: string;
  install_path: string; source: string;
}
export interface Overview { system: SystemInfo; gpu: GpuInfo; rocm: RocmStatus; }
export interface CompatCheck { id: string; label: string; status: "ok"|"warn"|"fail"; detail: string; weight: number; }
export interface CompatReport { score: number; checks: CompatCheck[]; }
export interface RepairPlan { steps: string[]; commands: string[]; }
export interface PyEnv { name: string; kind: string; path: string; python_version: string; packages: number; }
export interface StackItem { id: string; name: string; version: string; installed: boolean; install_hint: string; docs_url: string; }
export interface HfModel {
  id: string; name: string; downloads: number; likes: number;
  tags: string[]; pipeline: string; updated_at: string;
}
export interface OllamaModel { name: string; size: number; digest: string; modified_at: string; }
export interface ChatResponse {
  model: string; message: string; tokens: number; tps: number; ttft_ms: number; total_ms: number;
}
export interface BenchResult {
  id: number; ts: number; kind: string; model: string; backend: string;
  prefill_tps: number | null; decode_tps: number | null;
  ttft_ms: number | null; tokens: number | null;
}
export interface MetricsRow {
  ts: number; load: number; vram_used: number; vram_total: number;
  temp: number; fan: number; power: number;
}

// ---------- Commands ----------
export const api = {
  // system
  overview:        () => invoke<Overview>("sys_get_overview"),
  metrics:         () => invoke<GpuMetrics>("sys_get_metrics"),
  metricsHistory:  (since_secs: number) => invoke<MetricsRow[]>("sys_metrics_history", { sinceSecs: since_secs }),
  exportMetrics:   (dest: string, format: "csv"|"json") => invoke<string>("sys_export_metrics", { dest, format }),

  // rocm
  rocmDetect:      () => invoke<RocmStatus>("rocm_detect"),
  rocmCompat:      () => invoke<CompatReport>("rocm_compatibility"),
  rocmRepair:      () => invoke<RepairPlan>("rocm_repair_dryrun"),

  // env
  envList:         () => invoke<PyEnv[]>("env_list"),
  envCreate:       (name: string) => invoke<PyEnv>("env_create", { name }),
  envDelete:       (path: string) => invoke<void>("env_delete", { path }),
  envPackages:     (path: string) => invoke<[string, string][]>("env_packages", { path }),

  // stack
  stackDetect:     () => invoke<StackItem[]>("stack_detect"),
  stackInstall:    (id: string) => invoke<{ ok: boolean; output: string }>("stack_install", { id }),

  // models
  searchHF:        (query: string, limit = 20) => invoke<HfModel[]>("model_search_hf", { query, limit }),
  ollamaList:      () => invoke<OllamaModel[]>("model_ollama_list"),
  ollamaPull:      (name: string) => invoke<void>("model_ollama_pull", { name }),
  ollamaDelete:    (name: string) => invoke<void>("model_ollama_delete", { name }),

  // inference
  chat:            (model: string, prompt: string) => invoke<ChatResponse>("inference_chat", { model, prompt }),

  // benchmark
  benchRunLlm:     (model: string) => invoke<BenchResult>("bench_run_llm", { model }),
  benchHistory:    () => invoke<BenchResult[]>("bench_history"),

  // util
  openExternal:    (url: string) => invoke<void>("open_external", { url }),
  shell:           (program: string, args: string[]) =>
    invoke<{ ok: boolean; stdout: string; stderr: string }>("run_shell", { program, args }),
};

// ---------- Events ----------
export function onGpuMetrics(cb: (m: GpuMetrics) => void): Promise<UnlistenFn> {
  return listen<GpuMetrics>("gpu:metrics", (e) => cb(e.payload));
}
export function onGpuInfo(cb: (i: GpuInfo) => void): Promise<UnlistenFn> {
  return listen<GpuInfo>("gpu:info", (e) => cb(e.payload));
}
