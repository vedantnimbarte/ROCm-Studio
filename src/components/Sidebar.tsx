import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { utcClock } from "../lib/format";
import { useStore } from "../lib/store";

interface NavDef { code: string; to: string; label: string; badge?: string; live?: boolean; }
const SECTIONS: { title: string; items: NavDef[] }[] = [
  { title: "Telemetry", items: [
    { code: "M01", to: "/dashboard", label: "Dashboard", live: true },
    { code: "M09", to: "/gpu", label: "GPU Monitor", live: true },
  ]},
  { title: "Runtime", items: [
    { code: "M02", to: "/rocm", label: "ROCm Manager" },
    { code: "M03", to: "/compat", label: "Compatibility" },
    { code: "M04", to: "/envs", label: "Environments" },
    { code: "M05", to: "/stack", label: "AI Stack" },
  ]},
  { title: "Models", items: [
    { code: "M06", to: "/models", label: "Model Library" },
    { code: "M07", to: "/inference", label: "Inference", live: true },
    { code: "M08", to: "/bench", label: "Benchmark" },
  ]},
];

export default function Sidebar() {
  const [clock, setClock] = useState(utcClock());
  const overview = useStore((s) => s.overview);
  useEffect(() => {
    const t = setInterval(() => setClock(utcClock()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside className="border-r border-hairline bg-gradient-to-b from-bg-2 to-bg py-[22px] sticky top-0 h-screen overflow-y-auto flex flex-col">
      <div className="px-[22px] pb-[22px] border-b border-hairline mb-[18px]">
        <div className="flex items-center gap-[10px]">
          <div className="brand-logo" />
          <div>
            <div className="font-serif italic text-[22px] leading-none -tracking-[0.02em]">
              <b className="not-italic font-normal">ROCm</b> <span>Forge</span>
            </div>
            <div className="font-mono text-[9.5px] tracking-[0.22em] text-muted uppercase">
              v 0.1.0 · build 26052
            </div>
          </div>
        </div>
      </div>

      <div className="px-3">
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="font-mono text-[9.5px] tracking-[0.24em] text-muted uppercase px-[10px] pt-[14px] pb-2 flex justify-between">
              <span>{sec.title}</span>
              <span className="text-muted-2">{String(sec.items.length).padStart(2, "0")}</span>
            </div>
            {sec.items.map((it) => (
              <NavLink
                key={it.code}
                to={it.to}
                className={({ isActive }) =>
                  [
                    "grid grid-cols-[36px_1fr_auto] items-center px-[10px] py-2 font-mono text-[12.5px] text-ink-2 border border-transparent transition-all hover:text-ink hover:bg-panel relative",
                    isActive
                      ? "!text-ink !bg-gradient-to-r !from-[rgba(255,58,37,0.10)] !to-transparent !border-l-red"
                      : "",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={["text-[9.5px] tracking-[0.06em]", isActive ? "text-red" : "text-muted"].join(" ")}>{it.code}</span>
                    <span>{it.label}</span>
                    {it.live ? (
                      <span className="pill on">● LIVE</span>
                    ) : it.badge ? (
                      <span className="pill">{it.badge}</span>
                    ) : null}
                    {isActive && (
                      <span className="absolute -left-px top-1/2 -translate-y-1/2 w-[2px] h-5 bg-red"
                            style={{ boxShadow: "0 0 8px #ff3a25" }} />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-auto px-[22px] py-4 border-t border-hairline font-mono text-[10px] text-muted">
        <Row k="Host" v={overview?.system.hostname ?? "—"} />
        <Row k="Kernel" v={overview?.system.kernel ?? "—"} />
        <Row k="OS" v={overview?.system.os_name ?? "—"} />
        <div className="flex justify-between mt-2 text-phos">
          <span>● Online</span><span>{clock}</span>
        </div>
      </div>

      <style>{`
        .brand-logo {
          width: 28px; height: 28px;
          border: 1px solid #ff3a25;
          position: relative;
          background:
            linear-gradient(135deg, transparent 48%, #ff3a25 49% 51%, transparent 52%),
            linear-gradient(45deg, transparent 48%, #ff3a25 49% 51%, transparent 52%);
          box-shadow: 0 0 24px #ff3a2533, inset 0 0 8px rgba(255,58,37,0.2);
        }
        .brand-logo::after {
          content: "";
          position: absolute; inset: 6px;
          background: #ff3a25;
          box-shadow: 0 0 12px #ff3a25;
          animation: pulse 2.4s ease-in-out infinite;
        }
      `}</style>
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-px">
      <span>{k}</span>
      <span className="text-ink-2 truncate ml-2 max-w-[140px] text-right">{v}</span>
    </div>
  );
}
