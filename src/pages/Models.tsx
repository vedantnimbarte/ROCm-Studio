import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirm } from "@tauri-apps/plugin-dialog";
import { api, onPullProgress } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { bytes, compact } from "../lib/format";

export default function Models() {
  const qc = useQueryClient();
  const [q, setQ] = useState("llama");
  const [submitted, setSubmitted] = useState(q);
  const [pullName, setPullName] = useState("");
  const [progress, setProgress] = useState("");

  // Live pull progress (ollama streams status + completed/total per layer).
  useEffect(() => {
    let stop: (() => void) | null = null;
    onPullProgress((p) => {
      const pct = p.total && p.completed ? ` ${Math.round((p.completed / p.total) * 100)}%` : "";
      setProgress((p.status || "") + pct);
    }).then((un) => { stop = un; });
    return () => { stop?.(); };
  }, []);

  const { data: hf = [], isFetching: hfLoading } = useQuery({
    queryKey: ["hf", submitted],
    queryFn: () => api.searchHF(submitted, 20),
    enabled: !!submitted,
  });
  const { data: local = [], refetch: refetchLocal } = useQuery({
    queryKey: ["ollama-list"],
    queryFn: api.ollamaList,
    refetchInterval: 30_000,
  });

  const pull = useMutation({
    mutationFn: (name: string) => api.ollamaPullStream(name),
    onSettled: () => { setPullName(""); setProgress(""); qc.invalidateQueries({ queryKey: ["ollama-list"] }); },
  });
  const del = useMutation({
    mutationFn: (name: string) => api.ollamaDelete(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ollama-list"] }),
  });

  async function onDelete(name: string) {
    const ok = await confirm(`Delete model "${name}" from Ollama?`, { title: "Confirm", kind: "warning" });
    if (ok) del.mutate(name);
  }

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "MODELS" }, { label: "LIBRARY · M06", accent: true }]}
        title={<>Curate the <em className="italic text-red">menagerie.</em></>}
        sub={<>Search Hugging Face · manage local Ollama models. Pulls run against http://localhost:11434.</>}
        actions={
          <button className="btn" onClick={() => refetchLocal()}>REFRESH LOCAL</button>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel className="col-span-7"
               title={<><b>Hugging Face</b> · search</>}
               meta={<span>{hf.length} result{hf.length===1?"":"s"}</span>}>
          <form className="flex gap-2 mb-4"
                onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }}>
            <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="search Hugging Face…" />
            <button className="btn primary" disabled={hfLoading}>{hfLoading ? "…" : "SEARCH"}</button>
          </form>
          <div className="border border-hairline bg-bg-2 max-h-[480px] overflow-y-auto">
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-muted uppercase text-[9.5px] tracking-[0.16em]">
                  <th className="text-left p-2 border-b border-hairline">MODEL</th>
                  <th className="text-right p-2 border-b border-hairline">DOWNLOADS</th>
                  <th className="text-right p-2 border-b border-hairline">LIKES</th>
                  <th className="p-2 border-b border-hairline"></th>
                </tr>
              </thead>
              <tbody>
                {hf.map((m) => (
                  <tr key={m.id} className="border-b border-hairline last:border-b-0 hover:bg-panel-2">
                    <td className="p-2">
                      <div className="text-ink">{m.name || m.id}</div>
                      <div className="text-muted text-[10px]">{m.pipeline || "—"} · {m.tags.slice(0, 3).join(", ")}</div>
                    </td>
                    <td className="p-2 text-right text-ink-2">{compact(m.downloads)}</td>
                    <td className="p-2 text-right text-ink-2">{compact(m.likes)}</td>
                    <td className="p-2 text-right">
                      <button className="text-cyan hover:underline text-[10px] uppercase tracking-[0.16em]"
                              onClick={() => api.openExternal(`https://huggingface.co/${m.id}`)}>OPEN ↗</button>
                    </td>
                  </tr>
                ))}
                {hf.length === 0 && !hfLoading && (
                  <tr><td colSpan={4} className="p-4 text-center text-muted">no results — try another query</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="col-span-5"
               title={<><b>Ollama</b> · local models</>}
               meta={<span>{local.length} on disk</span>}>
          <form className="flex gap-2 mb-4"
                onSubmit={(e) => { e.preventDefault(); if (pullName.trim()) pull.mutate(pullName.trim()); }}>
            <input className="input flex-1" value={pullName} onChange={(e) => setPullName(e.target.value)}
                   placeholder="e.g. llama3.2:3b" />
            <button className="btn primary" disabled={!pullName.trim() || pull.isPending}>
              {pull.isPending ? "PULLING…" : "PULL"}
            </button>
          </form>
          {pull.isPending && progress && (
            <div className="font-mono text-[10px] text-cyan mb-3">{progress}</div>
          )}
          {pull.isError && (
            <div className="font-mono text-[10px] text-red mb-3">{(pull.error as Error).message}</div>
          )}
          <div className="border border-hairline bg-bg-2">
            {local.map((m) => (
              <div key={m.digest} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2.5 border-b border-hairline last:border-b-0">
                <div>
                  <div className="font-mono text-[12px] text-ink">{m.name}</div>
                  <div className="font-mono text-[10px] text-muted">{bytes(m.size)}</div>
                </div>
                <span className="pill on">LOCAL</span>
                <button onClick={() => onDelete(m.name)} className="font-mono text-[10px] uppercase tracking-[0.18em] text-red hover:underline">✕</button>
              </div>
            ))}
            {local.length === 0 && (
              <div className="font-mono text-[11px] text-muted p-4 text-center">
                no local models — pull one above.<br />
                <span className="text-[10px]">Is Ollama running at localhost:11434?</span>
              </div>
            )}
          </div>
        </Panel>
      </section>
    </>
  );
}
