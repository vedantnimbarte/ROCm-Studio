import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import MetricChart from "../components/MetricChart";
import { mb, timeAgo } from "../lib/format";

export default function Dashboard() {
  const o = useStore((s) => s.overview);
  const m = useStore((s) => s.metrics);
  const hist = useStore((s) => s.metricsHistory);
  const series = hist.map((x) => x.load_pct);

  return (
    <>
      <PageHeader
        crumb={[
          { label: "FORGE" },
          { label: "CONTROL" },
          { label: "DASHBOARD · M01", accent: true },
        ]}
        title={<>Mission control<br /><em className="italic text-red">for silicon.</em></>}
        sub={
          <>
            Real-time telemetry · <span className="text-muted">last sync</span>{" "}
            <b className="text-ink">{m ? timeAgo(m.ts) : "—"}</b> ·{" "}
            <span className="text-muted">backend</span>{" "}
            <b className="text-ink">{o?.gpu.backend ?? "—"}</b>
          </>
        }
        actions={
          <>
            <Link to="/gpu" className="btn">VIEW HISTORY</Link>
            <Link to="/compat" className="btn primary">RUN DIAGNOSTICS</Link>
          </>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        {/* HERO TELEMETRY */}
        <Panel
          className="col-span-8 row-span-2 min-h-[420px]"
          title={
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red"
                    style={{ boxShadow: "0 0 8px #ff3a25" }} />
              {o?.gpu.name ?? "GPU"} · <b>PRIMARY</b>
            </span>
          }
          meta={<><span>SAMPLE 1.00 Hz</span><span className="live-dot">STREAMING</span></>}
          noBody
        >
          <div className="grid grid-cols-[240px_1fr] gap-6 p-6">
            <div className="border-r border-hairline pr-6">
              <div className="mono-tag mb-1.5">GPU Load</div>
              <div className="font-serif italic text-[92px] leading-[0.85] -tracking-[0.04em] text-ink flex items-baseline gap-1">
                {Math.round(m?.load_pct ?? 0)}
                <span className="font-mono not-italic text-sm text-muted tracking-[0.1em]">%</span>
              </div>
              <div className="mt-3.5 font-mono text-[10.5px] text-ink-2 leading-relaxed">
                <span className="text-phos">{(m?.load_pct ?? 0) > 60 ? "▲" : "▼"} live</span> · sampled 1 Hz<br />
                clock <span className="text-ink">{m ? Math.round(m.clock_mhz) : "—"} MHz</span><br />
                vram <span className="text-ink">{mb(m?.vram_used_mb ?? 0)} / {mb(m?.vram_total_mb ?? 0)}</span>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="grid grid-cols-4 gap-3 mb-3.5">
                <MiniStat label="VRAM" val={mb(m?.vram_used_mb ?? 0)} sub={`of ${mb(m?.vram_total_mb ?? 0)}`}
                          pct={((m?.vram_used_mb ?? 0) / Math.max(1, m?.vram_total_mb ?? 1)) * 100} />
                <MiniStat label="Temp" val={`${Math.round(m?.temp_c ?? 0)}°C`} sub="junction"
                          pct={(m?.temp_c ?? 0) / 110 * 100} tone={(m?.temp_c ?? 0) > 85 ? "warn" : "ok"} />
                <MiniStat label="Fan" val={`${Math.round(m?.fan_pct ?? 0)}%`} sub="auto"
                          pct={m?.fan_pct ?? 0} />
                <MiniStat label="Power" val={`${Math.round(m?.power_w ?? 0)} W`} sub="board"
                          pct={(m?.power_w ?? 0) / 400 * 100} tone={(m?.power_w ?? 0) > 350 ? "crit" : "ok"} />
              </div>
              <div className="flex-1 min-h-[180px]">
                <MetricChart data={series} max={100} unit="%" />
              </div>
            </div>
          </div>
        </Panel>

        {/* SYSTEM OVERVIEW */}
        <Panel className="col-span-4" title={<><b>System</b> · M01</>}
               meta={<span>OS · {o?.system.os_name}</span>}>
          <div className="font-mono text-[11px] space-y-1.5">
            <Row k="GPU" v={o?.gpu.name ?? "—"} />
            <Row k="VENDOR" v={o?.gpu.vendor ?? "—"} />
            <Row k="ARCH" v={o?.gpu.arch || (o?.gpu.backend === "mock" ? "(simulated)" : "—")} />
            <Row k="DRIVER" v={o?.gpu.driver ?? "—"} />
            <Row k="ROCm" v={o?.rocm.installed ? o.rocm.rocm_version : "not installed"} />
            <Row k="HIP" v={o?.rocm.hip_version ?? "—"} />
            <Row k="KERNEL" v={o?.system.kernel ?? "—"} />
            <Row k="CPU" v={`${o?.system.cpu ?? "—"} · ${o?.system.cpu_cores ?? 0}C`} />
            <Row k="RAM" v={o ? `${(o.system.used_mem_mb / 1024).toFixed(1)} / ${(o.system.total_mem_mb / 1024).toFixed(1)} GB` : "—"} />
            <Row k="BACKEND" v={o?.gpu.backend ?? "—"} accent={o?.gpu.backend === "mock"} />
          </div>
        </Panel>

        {/* INFERENCE TEASER */}
        <Panel className="col-span-4" title={<><b>Inference</b> · M07</>}
               meta={<Link to="/inference" className="text-cyan hover:underline text-[10px]">OPEN →</Link>}>
          <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
            Launch local models against Ollama. Track tokens/sec, TTFT and VRAM in real time. Compare runs.
          </div>
          <Link to="/inference" className="btn mt-3 inline-flex">START CHAT →</Link>
        </Panel>

        {/* QUICK ACTIONS */}
        <section className="col-span-12 grid grid-cols-6 border border-hairline bg-panel">
          {ACTIONS.map((a, i) => (
            <Link key={a.num} to={a.to} className="p-[18px] border-r border-hairline last:border-r-0 relative cursor-pointer transition hover:bg-panel-2 group">
              <div className="font-mono text-[9px] tracking-[0.2em] text-muted">{a.num}</div>
              <div className="font-serif italic text-[22px] leading-[1.05] -tracking-[0.02em] my-1.5">{a.title}</div>
              <div className="font-mono text-[10px] text-muted leading-relaxed max-w-[90%]">{a.desc}</div>
              <div className="absolute top-4 right-4 text-muted group-hover:text-red transition font-mono group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform">↗</div>
            </Link>
          ))}
        </section>
      </section>
    </>
  );
}

function MiniStat({ label, val, sub, pct, tone = "ok" }:
  { label: string; val: string; sub?: string; pct: number; tone?: "ok"|"warn"|"crit" }) {
  const colors: Record<string,string> = { ok: "#b6ff8a", warn: "#ffb627", crit: "#ff3a25" };
  return (
    <div className="border border-hairline bg-bg-2 px-3 py-2.5">
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted">{label}</div>
      <div className="font-mono text-[18px] text-ink mt-1 font-medium">
        {val}{sub && <span className="text-muted text-[11px] ml-1">· {sub}</span>}
      </div>
      <div className="mt-1.5 h-[2px] bg-hairline relative overflow-hidden">
        <div className="absolute inset-y-0 left-0"
             style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: colors[tone], boxShadow: `0 0 6px ${colors[tone]}66` }} />
      </div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline">
      <span className="text-muted uppercase text-[9.5px] tracking-[0.18em]">{k}</span>
      <span className={"text-ink-2 truncate " + (accent ? "text-amber" : "")}>{v}</span>
    </div>
  );
}

const ACTIONS = [
  { num: "Q.01", to: "/rocm",      title: <>Install<br />ROCm</>,       desc: "Detect GPU, resolve deps, deploy runtime." },
  { num: "Q.02", to: "/envs",      title: <>New<br />environment</>,    desc: "venv · conda · uv · pip — your call." },
  { num: "Q.03", to: "/models",    title: <>Pull a<br />model</>,       desc: "From HF, Ollama. Quantize, store." },
  { num: "Q.04", to: "/bench",     title: <>Run<br />benchmark</>,      desc: "LLM TPS + TTFT. Track over time." },
  { num: "Q.05", to: "/stack",     title: <>Install<br />stack</>,      desc: "PyTorch, vLLM, Ollama, Jupyter." },
  { num: "Q.06", to: "/compat",    title: <>Scan<br />system</>,        desc: "Compatibility score with reasoning." },
];
