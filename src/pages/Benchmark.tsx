import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { timeAgo } from "../lib/format";

export default function Benchmark() {
  const qc = useQueryClient();
  const [model, setModel] = useState("");
  const { data: locals = [] } = useQuery({ queryKey: ["ollama-list"], queryFn: api.ollamaList });
  const { data: history = [] } = useQuery({ queryKey: ["bench"], queryFn: api.benchHistory });

  const run = useMutation({
    mutationFn: (m: string) => api.benchRunLlm(m),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bench"] }),
  });

  if (!model && locals.length) setModel(locals[0].name);

  const ranked = [...history].sort((a, b) => (b.decode_tps ?? 0) - (a.decode_tps ?? 0));

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "MODELS" }, { label: "BENCHMARK · M08", accent: true }]}
        title={<>Numbers,<br /><em className="italic text-red">not vibes.</em></>}
        sub={<>Run a fixed prompt through your local Ollama model and record tokens/sec, TTFT. Persisted in SQLite.</>}
        actions={
          <>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input"
            >
              {locals.length === 0 && <option value="">— no local models —</option>}
              {locals.map((m) => <option key={m.digest} value={m.name}>{m.name}</option>)}
            </select>
            <button className="btn primary" disabled={!model || run.isPending}
                    onClick={() => model && run.mutate(model)}>
              {run.isPending ? "RUNNING…" : "RUN BENCHMARK"}
            </button>
          </>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel className="col-span-12" title={<><b>Leaderboard</b> · local runs</>}
               meta={<span>{history.length} run{history.length === 1 ? "" : "s"}</span>} noBody>
          <div>
            <div className="grid grid-cols-[60px_2fr_1fr_1fr_1fr_1fr_120px] items-center px-[18px] py-3 border-b border-hairline font-mono text-[9.5px] tracking-[0.18em] uppercase text-muted bg-bg-2">
              <div>RANK</div>
              <div>MODEL</div>
              <div className="text-right">DECODE TPS</div>
              <div className="text-right">TTFT (ms)</div>
              <div className="text-right">TOKENS</div>
              <div className="text-right">BACKEND</div>
              <div className="text-right">WHEN</div>
            </div>
            {ranked.length === 0 ? (
              <div className="p-8 text-center font-mono text-[11px] text-muted">
                no runs yet — pick a local model and click <span className="text-red">RUN BENCHMARK</span>.
              </div>
            ) : (
              ranked.map((r, i) => (
                <div key={r.id} className="grid grid-cols-[60px_2fr_1fr_1fr_1fr_1fr_120px] items-center px-[18px] py-3 border-b border-hairline last:border-b-0 font-mono text-[11px]">
                  <div className={"font-serif italic text-[22px] -tracking-[0.02em] " + (i === 0 ? "text-amber" : i === 1 ? "text-cyan" : "text-red")}>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <div className="text-ink">{r.model}</div>
                    <div className="text-muted text-[10px]">{r.kind}</div>
                  </div>
                  <div className="text-right text-ink font-medium">{r.decode_tps?.toFixed(1) ?? "—"}</div>
                  <div className="text-right text-ink-2">{r.ttft_ms?.toFixed(0) ?? "—"}</div>
                  <div className="text-right text-ink-2">{r.tokens ?? "—"}</div>
                  <div className="text-right text-muted">{r.backend}</div>
                  <div className="text-right text-muted">{timeAgo(r.ts)}</div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>
    </>
  );
}
