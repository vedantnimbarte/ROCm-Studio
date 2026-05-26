import { useStore } from "../lib/store";

export default function Marquee() {
  const o = useStore((s) => s.overview);
  const m = useStore((s) => s.metrics);
  const items = [
    o?.rocm.installed ? <><b>ROCm {o.rocm.rocm_version}</b> detected</> : <><span className="text-red">⚠</span> ROCm not installed</>,
    <><span className="text-phos">●</span> daemon healthy</>,
    o?.gpu ? <><b>{o.gpu.name}</b> · {o.gpu.arch || "—"}</> : <>detecting GPU…</>,
    m ? <>load <b>{Math.round(m.load_pct)}%</b> · vram <b>{m.vram_used_mb} / {m.vram_total_mb} MB</b> · temp <b>{Math.round(m.temp_c)}°C</b></> : <>telemetry warming up…</>,
    <>backend <b>{o?.gpu.backend ?? "—"}</b></>,
    <>kernel {o?.system.kernel}</>,
    <>Forge v0.1.0 · build 26052</>,
    <>—</>,
  ];
  const doubled = [...items, ...items];
  return (
    <footer className="h-[30px] border-t border-hairline bg-bg-2 overflow-hidden flex items-center font-mono text-[10.5px] text-muted tracking-[0.06em] relative">
      <div className="flex gap-9 whitespace-nowrap animate-scroll pl-full">
        {doubled.map((x, i) => <span key={i}>{x}</span>)}
      </div>
      <style>{`
        .pl-full { padding-left: 100%; }
      `}</style>
    </footer>
  );
}
