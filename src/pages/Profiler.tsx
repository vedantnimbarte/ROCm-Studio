import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

interface ProfilerStatus {
  available: boolean;
  tool: string;
}
interface KernelStat {
  name: string;
  calls: number;
  total_ns: number;
  avg_ns: number;
  pct: number;
}
interface TraceSpan {
  name: string;
  start_ns: number;
  dur_ns: number;
  lane: number;
}
interface ProfileResult {
  tool: string;
  target: string;
  total_ns: number;
  kernels: KernelStat[];
  trace: TraceSpan[];
  lanes: number;
  raw_path: string;
  notes: string;
}

// ns → human unit. Kernel times span ns..ms, so pick per value.
function fmt(ns: number): string {
  if (!ns) return "0";
  if (ns < 1_000) return `${ns} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

const ROW_H = 22;

export default function Profiler() {
  const [target, setTarget] = useState("");
  const [argsText, setArgsText] = useState("");

  const { data: status } = useQuery({
    queryKey: ["profiler-available"],
    queryFn: () => invoke<ProfilerStatus>("profiler_available"),
  });

  const run = useMutation({
    mutationFn: (p: { target: string; args: string[] }) =>
      invoke<ProfileResult>("profiler_run", p),
  });

  const available = status?.available ?? false;
  const result = run.data;

  function onRun() {
    const t = target.trim();
    if (!t) return;
    const args = argsText.trim().split(/\s+/).filter(Boolean);
    run.mutate({ target: t, args });
  }

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "TOOLS" }, { label: "PROFILER · M10", accent: true }]}
        title={<>See every<br /><em className="italic text-red">kernel.</em></>}
        sub={
          available ? (
            <>Profiling with <span className="text-red">{status?.tool}</span> — run a command and read back per-kernel stats and a dispatch timeline.</>
          ) : (
            <>rocprof not detected — install ROCm profiler tools to enable kernel profiling.</>
          )
        }
        actions={
          <form
            onSubmit={(e) => { e.preventDefault(); onRun(); }}
            className="flex gap-2 items-center"
          >
            <input
              className="input w-[240px]"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="./my_gpu_binary"
              disabled={!available || run.isPending}
            />
            <input
              className="input w-[160px]"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="args…"
              disabled={!available || run.isPending}
            />
            <button className="btn primary" disabled={!available || run.isPending || !target.trim()} onClick={onRun}>
              {run.isPending ? "PROFILING…" : "RUN"}
            </button>
          </form>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        {!available ? (
          <Panel className="col-span-12" title={<><b>Profiler unavailable</b></>}>
            <div className="font-mono text-[11px] text-muted leading-relaxed">
              <p className="mb-3">
                Neither <span className="text-ink">rocprof</span> nor <span className="text-ink">rocprofv3</span> was
                found on <span className="text-red">PATH</span>. These ship with the ROCm profiler tools.
              </p>
              <p>
                Install ROCm (which bundles <span className="text-ink">rocprof</span>), then reopen this page.
                Profiling requires an AMD GPU and the ROCm runtime present on the machine.
              </p>
            </div>
          </Panel>
        ) : run.isPending ? (
          <Panel className="col-span-12" title={<><b>Running rocprof…</b></>}>
            <div className="font-mono text-[11px] text-muted">
              Launching <span className="text-ink">{target}</span> under {status?.tool} and collecting kernel dispatches…
            </div>
          </Panel>
        ) : run.isError ? (
          <Panel className="col-span-12" title={<><b>Profile failed</b></>}>
            <div className="font-mono text-[11px] text-red">{(run.error as Error).message}</div>
          </Panel>
        ) : !result ? (
          <Panel className="col-span-12" title={<><b>No profile yet</b></>}>
            <div className="font-mono text-[11px] text-muted">
              Enter a command or binary above and click <span className="text-red">RUN</span> to profile its GPU kernels.
            </div>
          </Panel>
        ) : (
          <>
            <div className="col-span-12 grid grid-cols-4 gap-[18px]">
              <Tile label="Total kernel time" v={fmt(result.total_ns)} />
              <Tile label="Kernels" v={String(result.kernels.length)} />
              <Tile label="Dispatches" v={String(result.trace.length)} />
              <Tile label="Tool" v={result.tool} />
            </div>

            <Panel
              className="col-span-12"
              title={<><b>Timeline</b> · kernel dispatches</>}
              meta={<span>{result.lanes} lane{result.lanes === 1 ? "" : "s"} · {fmt(result.total_ns)}</span>}
            >
              <Timeline result={result} />
            </Panel>

            <Panel
              className="col-span-12"
              title={<><b>Kernel statistics</b></>}
              meta={<span>{result.kernels.length} kernel{result.kernels.length === 1 ? "" : "s"}</span>}
              noBody
            >
              <StatsTable kernels={result.kernels} />
            </Panel>

            {result.notes && (
              <div className="col-span-12 font-mono text-[10px] text-muted tracking-[0.04em]">
                {result.notes} · raw: <span className="text-ink-2">{result.raw_path}</span>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Timeline({ result }: { result: ProfileResult }) {
  const [hover, setHover] = useState<TraceSpan | null>(null);
  const total = result.total_ns || 1;
  const height = Math.max(result.lanes, 1) * ROW_H;

  if (result.trace.length === 0) {
    return <div className="font-mono text-[11px] text-muted py-6 text-center">no kernel dispatches captured</div>;
  }

  // Vary red opacity per distinct kernel name so repeated kernels read the same.
  const names = Array.from(new Set(result.trace.map((s) => s.name)));
  const opacity = (name: string) => 0.35 + (0.6 * (names.indexOf(name) % 6)) / 6;

  return (
    <div>
      <div className="relative border border-hairline bg-bg-2" style={{ height }}>
        {result.trace.map((s, i) => {
          const left = (s.start_ns / total) * 100;
          const width = Math.max((s.dur_ns / total) * 100, 0.4);
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(null)}
              title={`${s.name} · ${fmt(s.dur_ns)}`}
              className="absolute cursor-pointer transition-opacity hover:!opacity-100"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: s.lane * ROW_H + 2,
                height: ROW_H - 4,
                background: "#ff3a25",
                opacity: opacity(s.name),
              }}
            />
          );
        })}
      </div>
      {/* time axis */}
      <div className="flex justify-between font-mono text-[9px] text-muted mt-1.5 tracking-[0.1em]">
        <span>0</span>
        <span>{fmt(total / 2)}</span>
        <span>{fmt(total)}</span>
      </div>
      <div className="font-mono text-[10px] mt-2 h-4">
        {hover ? (
          <span className="text-ink-2">
            <span className="text-red">▮</span> {hover.name} — {fmt(hover.dur_ns)} @ {fmt(hover.start_ns)}
          </span>
        ) : (
          <span className="text-muted">hover a span for kernel name + duration</span>
        )}
      </div>
    </div>
  );
}

function StatsTable({ kernels }: { kernels: KernelStat[] }) {
  const ranked = [...kernels].sort((a, b) => b.total_ns - a.total_ns);
  return (
    <div>
      <div className="grid grid-cols-[3fr_1fr_1.2fr_1.2fr_1.6fr] items-center px-[18px] py-3 border-b border-hairline font-mono text-[9.5px] tracking-[0.18em] uppercase text-muted bg-bg-2">
        <div>KERNEL</div>
        <div className="text-right">CALLS</div>
        <div className="text-right">TOTAL</div>
        <div className="text-right">AVG</div>
        <div className="text-right">%</div>
      </div>
      {ranked.length === 0 ? (
        <div className="p-8 text-center font-mono text-[11px] text-muted">no kernel stats captured</div>
      ) : (
        ranked.map((k, i) => (
          <div key={i} className="grid grid-cols-[3fr_1fr_1.2fr_1.2fr_1.6fr] items-center px-[18px] py-3 border-b border-hairline last:border-b-0 font-mono text-[11px]">
            <div className="text-ink truncate pr-4" title={k.name}>{k.name}</div>
            <div className="text-right text-ink-2">{k.calls}</div>
            <div className="text-right text-ink-2">{fmt(k.total_ns)}</div>
            <div className="text-right text-muted">{fmt(k.avg_ns)}</div>
            <div className="flex items-center gap-2 justify-end">
              <div className="h-[6px] w-[70px] bg-bg-2 border border-hairline relative">
                <div className="absolute left-0 top-0 h-full" style={{ width: `${Math.min(k.pct, 100)}%`, background: "#ff3a25" }} />
              </div>
              <span className="text-ink w-[44px] text-right">{k.pct.toFixed(1)}%</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Tile({ label, v }: { label: string; v: string }) {
  return (
    <div className="border border-hairline bg-bg-2 px-3 py-2.5">
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted">{label}</div>
      <div className="font-mono text-[16px] text-ink mt-1 truncate">{v}</div>
    </div>
  );
}
