import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

export default function Compatibility() {
  const { data: report, refetch, isFetching } = useQuery({
    queryKey: ["compat"],
    queryFn: api.rocmCompat,
  });
  const score = report?.score ?? 0;

  // Gauge math: arc length for r=68 ≈ 427
  const ARC = 427;
  const offset = ARC * (1 - score / 100);

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "RUNTIME" }, { label: "COMPATIBILITY · M03", accent: true }]}
        title={<>Score, then <em className="italic text-red">justify.</em></>}
        sub={<>Each weighted check explains the score. Re-run after changes.</>}
        actions={
          <button className="btn primary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "SCANNING…" : "RE-SCAN"}
          </button>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel className="col-span-5" title={<><b>System score</b></>}>
          <div className="grid grid-cols-[180px_1fr] gap-6 items-center">
            <div className="relative w-[180px] h-[180px]">
              <svg viewBox="0 0 160 160" className="-rotate-90 w-full h-full">
                <circle cx="80" cy="80" r="68" fill="none" stroke="#22222a" strokeWidth="6" />
                <circle cx="80" cy="80" r="68" fill="none"
                        stroke={score >= 80 ? "#b6ff8a" : score >= 50 ? "#ffb627" : "#ff3a25"}
                        strokeWidth="6"
                        strokeDasharray={ARC}
                        strokeDashoffset={offset}
                        strokeLinecap="square"
                        style={{ filter: `drop-shadow(0 0 8px ${score >= 80 ? "#b6ff8a55" : score >= 50 ? "#ffb62755" : "#ff3a2555"})`, transition: "stroke-dashoffset .6s ease" }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="font-serif italic text-[68px] leading-none -tracking-[0.03em]">{score}</div>
                  <div className="font-mono text-[9.5px] tracking-[0.2em] uppercase text-muted mt-1">/ 100</div>
                </div>
              </div>
            </div>
            <div className="font-mono text-[11.5px] text-ink-2 leading-relaxed">
              <div className="font-serif italic text-[20px] text-ink mb-2 -tracking-[0.02em]">
                {score >= 80 ? "Ready." : score >= 50 ? "Almost there." : "Needs work."}
              </div>
              {score >= 80
                ? "Your system meets the requirements to run ROCm workloads. Minor warnings (if any) are non-blocking."
                : score >= 50
                ? "ROCm should work, but you have warnings or missing optional components. Review the checks → for impact."
                : "Critical gaps detected. Resolve the failing checks before attempting GPU workloads."}
            </div>
          </div>
        </Panel>

        <Panel className="col-span-7" title={<><b>Detailed checks</b></>}>
          <div className="divide-y divide-hairline">
            {(report?.checks ?? []).map((c) => (
              <div key={c.id} className="grid grid-cols-[20px_1fr_auto_60px] gap-3 items-center py-3 font-mono text-[12px]">
                <span className={
                  c.status === "ok" ? "text-phos" :
                  c.status === "warn" ? "text-amber" : "text-red"
                }>
                  {c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✕"}
                </span>
                <div>
                  <div className="text-ink">{c.label}</div>
                  <div className="text-muted text-[10.5px] mt-0.5 max-w-[420px] leading-snug">{c.detail}</div>
                </div>
                <span className={
                  "pill " + (c.status === "ok" ? "on" : c.status === "warn" ? "warn" : "crit")
                }>{c.status.toUpperCase()}</span>
                <span className="text-muted text-[10px] text-right">{c.weight === 0 ? "info" : "w " + c.weight}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </>
  );
}
