import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import MetricChart from "../components/MetricChart";
import { mb } from "../lib/format";

const RANGES = [
  { label: "10 min", secs: 600 },
  { label: "1 hour", secs: 3600 },
  { label: "6 hours", secs: 21_600 },
  { label: "1 day", secs: 86_400 },
  { label: "7 days", secs: 7 * 86_400 },
  { label: "30 days", secs: 30 * 86_400 },
];

export default function GpuMonitor() {
  const [range, setRange] = useState(RANGES[1]);
  const [busy, setBusy] = useState(false);
  const live = useStore((s) => s.metricsHistory);
  const m = useStore((s) => s.metrics);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["history", range.secs],
    queryFn: () => api.metricsHistory(range.secs),
    refetchInterval: 15_000,
  });

  async function exportFile(format: "csv" | "json") {
    setBusy(true);
    try {
      const path = await save({
        defaultPath: `rocm-forge-metrics.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      await api.exportMetrics(path, format);
    } finally {
      setBusy(false);
    }
  }

  // Build series from DB history, fall back to live ring buffer if DB is empty
  const source = history.length ? history : live.map((x) => ({
    ts: x.ts, load: x.load_pct, vram_used: x.vram_used_mb, vram_total: x.vram_total_mb,
    temp: x.temp_c, fan: x.fan_pct, power: x.power_w,
  }));
  const load = source.map((r) => r.load);
  const temp = source.map((r) => r.temp);
  const power = source.map((r) => r.power);
  const vram = source.map((r) => (r.vram_total ? (r.vram_used / r.vram_total) * 100 : 0));

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "TELEMETRY" }, { label: "GPU MONITOR · M09", accent: true }]}
        title={<>Trace<br /><em className="italic text-red">the silicon.</em></>}
        sub={<>Persisting {source.length} samples in window · stored locally in SQLite, pruned at 30 d.</>}
        actions={
          <>
            <button className="btn" onClick={() => exportFile("csv")} disabled={busy}>EXPORT CSV</button>
            <button className="btn primary" onClick={() => exportFile("json")} disabled={busy}>EXPORT JSON</button>
          </>
        }
      />
      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <div className="col-span-12 flex gap-2 items-center">
          <span className="mono-tag">RANGE</span>
          {RANGES.map((r) => (
            <button
              key={r.secs}
              onClick={() => setRange(r)}
              className={[
                "font-mono text-[10.5px] uppercase tracking-[0.14em] px-3 py-1.5 border",
                range.secs === r.secs
                  ? "border-red text-red bg-red-glow"
                  : "border-hairline-2 text-ink-2 hover:border-ink-2",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
          {isLoading && <span className="mono-tag ml-2">loading…</span>}
        </div>

        <Panel
          className="col-span-12"
          title={<><b>GPU utilization</b> · %</>}
          meta={<><span className="text-ink">{Math.round(m?.load_pct ?? 0)}%</span><span className="live-dot">LIVE</span></>}
        >
          <div className="h-[220px]"><MetricChart data={load} max={100} unit="%" color="#b6ff8a" height={220} /></div>
        </Panel>

        <Panel
          className="col-span-6"
          title={<><b>Temperature</b> · °C</>}
          meta={<span className="text-ink">{Math.round(m?.temp_c ?? 0)}°C</span>}
        >
          <div className="h-[180px]"><MetricChart data={temp} max={110} unit="°" color="#ffb627" height={180} /></div>
        </Panel>

        <Panel
          className="col-span-6"
          title={<><b>Power draw</b> · W</>}
          meta={<span className="text-ink">{Math.round(m?.power_w ?? 0)} W</span>}
        >
          <div className="h-[180px]"><MetricChart data={power} max={400} unit="W" color="#ff3a25" height={180} /></div>
        </Panel>

        <Panel
          className="col-span-12"
          title={<><b>VRAM usage</b> · % of {mb(m?.vram_total_mb ?? 0)}</>}
          meta={<span className="text-ink">{mb(m?.vram_used_mb ?? 0)}</span>}
        >
          <div className="h-[180px]"><MetricChart data={vram} max={100} unit="%" color="#7fc8e8" height={180} /></div>
        </Panel>
      </section>
    </>
  );
}
