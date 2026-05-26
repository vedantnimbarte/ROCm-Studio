# ROCm Forge

Mission control for the ROCm ecosystem — desktop app built with **Tauri 2**, **Rust** and **React + TypeScript**.

## What works today

Nine modules wired end-to-end against real backends — no mocks unless your system can't provide the data:

| #    | Module             | Real functionality                                                                                                  |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| M01  | Dashboard          | Live GPU telemetry at 1 Hz, system + ROCm overview, quick actions.                                                  |
| M02  | ROCm Manager       | Detects installed ROCm/HIP version, install path, computes a dry-run repair plan.                                   |
| M03  | Compatibility      | Weighted 0–100 score with per-check reasoning (GPU, driver, kernel, ROCm, container runtime).                       |
| M04  | Environments       | Discovers `venv`/`conda` envs across the standard locations, creates new venvs, lists installed packages, deletes.  |
| M05  | AI Stack Installer | Detects PyTorch / TensorFlow / Ollama / vLLM / llama.cpp / Open WebUI / ComfyUI / Jupyter and runs `pip install`.   |
| M06  | Model Library      | Hugging Face search (live API) + Ollama local models (list / pull / delete via the Ollama REST API).                |
| M07  | Inference          | Chat against any Ollama-served model. Per-turn tokens/sec, TTFT, total time measured.                               |
| M08  | Benchmark          | Fixed-prompt LLM run that records decode TPS, TTFT, token count — persisted to SQLite, ranked leaderboard.          |
| M09  | GPU Monitor        | 30-day metric history persisted in SQLite, 6 time ranges, CSV/JSON export via the system save dialog.               |

Telemetry source falls back in this order: **`rocm-smi --json`** → **AMDGPU sysfs** (Linux) → **WMI + perf counters** (Windows) → **mock waveform** (so the UI never freezes if no GPU is detectable).

## Prerequisites

You already confirmed Rust + Node are installed. Beyond that:

- **Windows**: WebView2 runtime (pre-installed on Windows 11) and MSVC build tools (typically already present if `cargo` works).
- **Linux**: `webkit2gtk-4.1`, `libayatana-appindicator3`, standard build essentials. Install with:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Optional for real functionality**: ROCm 6.x (Linux) or HIP SDK (Windows), Ollama at `localhost:11434`, Python 3 in PATH.

## Run it

```bash
npm install            # already done
npm run tauri dev      # starts Vite + opens the Tauri window
```

Build a production bundle:

```bash
npm run tauri build
```

## Project layout

```
.
├─ src/                       React + TS frontend
│  ├─ pages/                  one file per module (M01..M09)
│  ├─ components/             Shell, Sidebar, TopBar, Panel, MetricChart, …
│  ├─ lib/api.ts              typed wrapper around every Tauri command + events
│  ├─ lib/store.ts            Zustand store (overview + live ring buffer)
│  └─ styles.css              Tailwind + design tokens
│
└─ src-tauri/                 Rust backend
   ├─ src/
   │  ├─ lib.rs               app entry, command registration, sampler bootstrap
   │  ├─ commands.rs          every #[tauri::command] in one place
   │  ├─ gpu.rs               cross-platform GPU detection + sampling
   │  ├─ monitoring.rs        background 1 Hz sampler emitting "gpu:metrics"
   │  ├─ rocm.rs              ROCm/HIP detection + weighted compatibility scoring
   │  ├─ environments.rs      Python venv / conda discovery + create / delete
   │  ├─ ai_stack.rs          AI stack detection + pip install actions
   │  ├─ models.rs            Hugging Face search + Ollama REST client + chat
   │  ├─ benchmark.rs         LLM benchmark runner (writes to SQLite)
   │  ├─ db.rs                SQLite schema + 30-day metric pruning
   │  ├─ system.rs            sysinfo wrapper
   │  └─ error.rs             AppError → frontend-serializable
   └─ tauri.conf.json
```

## How the live telemetry works

`monitoring::spawn_sampler` runs a dedicated thread that calls `gpu::sample_metrics` once per second, **emits a Tauri event** (`gpu:metrics`), and **writes one row to SQLite**. The React side subscribes once at mount in `App.tsx` and pushes each sample into a 120-frame ring buffer in Zustand. Every page that displays live data just selects from that store — no per-page polling.

History panels query the SQLite `metrics_history` table via the `sys_metrics_history` command. The sampler prunes anything older than 30 days hourly.

## Cross-platform notes

| Capability                | Linux                                     | Windows                                           |
| ------------------------- | ----------------------------------------- | ------------------------------------------------- |
| GPU temperature / power   | rocm-smi (full), sysfs (partial)          | requires AMD drivers; falls back to mock          |
| ROCm version detection    | `/opt/rocm/.info/version`                 | `HIP_PATH` env + `C:\Program Files\AMD\ROCm`      |
| Python env discovery      | `~/envs`, `~/.virtualenvs`, conda         | same paths under Windows user profile             |
| Ollama integration        | works if Ollama daemon running            | works if Ollama for Windows installed             |
| `which`                   | `which`                                   | `where`                                           |

The mock waveform engages only when none of the real sources return data, so the UI demos cleanly on a system without ROCm — useful for development.

## Things explicitly NOT in this build

(Deferred from the PRD by scope choice.)

- M10 Profiler UI (rocprof timelines)
- M11 CUDA → ROCm migration scanner
- M12 Container Center
- M13 Diagnostics Bundle (zip)
- M14 AI Troubleshooting Assistant
- ROCm *install* (only detect / repair-plan). Installing the runtime needs sudo elevation and is out of scope for a sandboxed desktop app — the manager points you at the official guide.

## Design

Visual reference lives at `design-reference.html` — open it directly in a browser to see the mission-control aesthetic in static form. The Tauri app implements the same design system in React + Tailwind.

Type stack: *Instrument Serif* (display, italic) · *JetBrains Mono* (data) · *Geist* (body).
Palette: warm near-black + parchment ink, AMD-adjacent electric red as live-signal accent, phosphor green for telemetry, amber for warnings.
