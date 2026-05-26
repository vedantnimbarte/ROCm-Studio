import { useStore } from "../lib/store";

export default function TopBar() {
  const o = useStore((s) => s.overview);
  const gpu = useStore((s) => s.gpu) ?? o?.gpu;
  const rocm = o?.rocm;
  return (
    <div className="h-[44px] border-b border-hairline bg-bg-2 grid grid-cols-[1fr_auto] items-center px-5 sticky top-0 z-50 backdrop-blur-md">
      <div className="flex items-center gap-[18px] font-mono text-[11px] text-muted uppercase tracking-[0.12em] overflow-hidden">
        <Stat dot label="GPU" v={gpu?.name ?? "detecting…"} />
        <Sep />
        <Stat label="ARCH" v={gpu?.arch || (gpu?.backend === "mock" ? "simulated" : "—")} />
        <Sep />
        <Stat label="ROCm" v={rocm?.installed ? rocm.rocm_version : "not installed"} />
        <Sep />
        <Stat label="DRIVER" v={gpu?.driver || "—"} />
        <Sep />
        <Stat label="BACKEND" v={gpu?.backend ?? "—"} amber={gpu?.backend === "mock"} />
      </div>
      <div className="flex gap-[10px] items-center font-mono text-[11px] text-muted">
        <button className="icon-btn">⌕</button>
        <button className="icon-btn">⚙</button>
        <button className="icon-btn">!</button>
        <div className="ml-2 pl-3 border-l border-hairline flex items-center gap-2">
          <div className="w-6 h-6 grid place-items-center text-white font-mono text-[10px] font-bold"
               style={{ background: "linear-gradient(135deg, #ff3a25, #ff8055)" }}>
            PN
          </div>
          <span className="text-ink-2">marketing@cloudairy.com</span>
        </div>
      </div>
      <style>{`
        .icon-btn {
          width:28px; height:28px; border:1px solid #22222a;
          background:transparent; color:#b8b2a3; cursor:pointer;
          display:grid; place-items:center; transition:.15s;
        }
        .icon-btn:hover { border-color:#2c2c36; color:#ece8dc; }
      `}</style>
    </div>
  );
}

function Stat({ label, v, dot, amber }: { label: string; v: string; dot?: boolean; amber?: boolean }) {
  return (
    <div className="flex items-center gap-[6px] whitespace-nowrap">
      {dot && <span className="dot" />}
      <span>{label}</span>
      <b className={"font-medium " + (amber ? "text-amber" : "text-ink")}>{v}</b>
      <style>{`
        .dot { width:6px; height:6px; background:#b6ff8a; box-shadow:0 0 8px #b6ff8a; border-radius:50%; }
      `}</style>
    </div>
  );
}
function Sep() { return <div className="w-px h-3.5 bg-hairline-2" />; }
