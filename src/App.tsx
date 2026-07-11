import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { api, onGpuInfo, onGpuMetrics } from "./lib/api";
import { useStore } from "./lib/store";
import Shell from "./components/Shell";
import Dashboard from "./pages/Dashboard";
import GpuMonitor from "./pages/GpuMonitor";
import RocmManager from "./pages/RocmManager";
import Compatibility from "./pages/Compatibility";
import Environments from "./pages/Environments";
import AiStack from "./pages/AiStack";
import Models from "./pages/Models";
import Inference from "./pages/Inference";
import Benchmark from "./pages/Benchmark";
import Profiler from "./pages/Profiler";
import Migration from "./pages/Migration";
import Containers from "./pages/Containers";
import Diagnostics from "./pages/Diagnostics";

export default function App() {
  const setOverview = useStore((s) => s.setOverview);
  const setGpu = useStore((s) => s.setGpu);
  const pushMetrics = useStore((s) => s.pushMetrics);

  useEffect(() => {
    let stopMetrics: (() => void) | null = null;
    let stopInfo: (() => void) | null = null;
    (async () => {
      try { setOverview(await api.overview()); } catch {}
      stopInfo = await onGpuInfo((i) => setGpu(i));
      stopMetrics = await onGpuMetrics((m) => pushMetrics(m));
    })();
    return () => { stopMetrics?.(); stopInfo?.(); };
  }, [setOverview, setGpu, pushMetrics]);

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/gpu" element={<GpuMonitor />} />
        <Route path="/rocm" element={<RocmManager />} />
        <Route path="/compat" element={<Compatibility />} />
        <Route path="/envs" element={<Environments />} />
        <Route path="/stack" element={<AiStack />} />
        <Route path="/models" element={<Models />} />
        <Route path="/inference" element={<Inference />} />
        <Route path="/bench" element={<Benchmark />} />
        <Route path="/profiler" element={<Profiler />} />
        <Route path="/migrate" element={<Migration />} />
        <Route path="/containers" element={<Containers />} />
        <Route path="/diag" element={<Diagnostics />} />
      </Routes>
    </Shell>
  );
}
