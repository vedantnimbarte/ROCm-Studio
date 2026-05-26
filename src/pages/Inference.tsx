import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ChatResponse } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

interface Turn { role: "user" | "assistant"; text: string; meta?: ChatResponse; }

export default function Inference() {
  const [model, setModel] = useState<string>("");
  const [prompt, setPrompt] = useState("Explain why RDNA 3's WMMA is useful for fp16 matmul. One paragraph.");
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: models = [] } = useQuery({ queryKey: ["ollama-list"], queryFn: api.ollamaList });
  useEffect(() => { if (!model && models.length) setModel(models[0].name); }, [model, models]);

  const chat = useMutation({
    mutationFn: (p: string) => api.chat(model, p),
    onMutate: (p: string) => {
      setTurns((t) => [...t, { role: "user", text: p }]);
    },
    onSuccess: (res) => {
      setTurns((t) => [...t, { role: "assistant", text: res.message, meta: res }]);
    },
    onError: (err) => {
      setTurns((t) => [...t, { role: "assistant", text: `error: ${(err as Error).message}` }]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  const last = [...turns].reverse().find((t) => t.role === "assistant")?.meta;

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "MODELS" }, { label: "INFERENCE · M07", accent: true }]}
        title={<>Local <em className="italic text-red">first-class.</em></>}
        sub={<>Chat against any Ollama-served model. TPS, TTFT and total time are measured per turn.</>}
        actions={<button className="btn" onClick={() => setTurns([])}>CLEAR</button>}
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel className="col-span-3" title={<><b>Model</b></>} meta={<span>{models.length}</span>}>
          <div className="space-y-1">
            {models.map((m) => (
              <button key={m.digest} onClick={() => setModel(m.name)}
                      className={[
                        "w-full text-left font-mono text-[11px] p-2 border transition",
                        model === m.name ? "border-red text-red bg-red-glow" : "border-hairline text-ink-2 hover:border-hairline-2",
                      ].join(" ")}>
                {m.name}
              </button>
            ))}
            {models.length === 0 && (
              <div className="font-mono text-[11px] text-muted">
                No Ollama models found. Go to <span className="text-cyan">Models</span> to pull one.
              </div>
            )}
          </div>

          {last && (
            <div className="mt-5 pt-4 border-t border-hairline space-y-2">
              <Metric label="TOKENS"   v={String(last.tokens)} />
              <Metric label="TOK/SEC"  v={last.tps.toFixed(1)} accent />
              <Metric label="TTFT ms"  v={last.ttft_ms.toFixed(0)} />
              <Metric label="TOTAL ms" v={last.total_ms.toFixed(0)} />
            </div>
          )}
        </Panel>

        <Panel className="col-span-9" title={<><b>Chat</b> · {model || "—"}</>}
               meta={chat.isPending && <span className="live-dot">GENERATING</span>}>
          <div ref={scrollRef} className="bg-bg-2 border border-hairline p-4 h-[420px] overflow-y-auto font-mono text-[12px] space-y-3">
            {turns.length === 0 && <div className="text-muted">no turns yet — send the first prompt below.</div>}
            {turns.map((t, i) => (
              <div key={i}>
                <div className="font-mono text-[9.5px] tracking-[0.2em] uppercase text-muted mb-1">
                  {t.role === "user" ? "> USER" : "← " + (t.meta ? `${t.meta.tps.toFixed(1)} t/s · ${t.meta.tokens} tok` : "ASSISTANT")}
                </div>
                <div className={t.role === "user" ? "text-ink" : "text-phos whitespace-pre-wrap"}>{t.text}</div>
              </div>
            ))}
          </div>
          <form className="flex gap-2 mt-3"
                onSubmit={(e) => { e.preventDefault(); if (model && prompt.trim()) chat.mutate(prompt.trim()); }}>
            <input className="input flex-1" value={prompt} onChange={(e) => setPrompt(e.target.value)}
                   placeholder="ask anything…" />
            <button className="btn primary" disabled={!model || chat.isPending}>
              {chat.isPending ? "GENERATING…" : "SEND →"}
            </button>
          </form>
        </Panel>
      </section>
    </>
  );
}

function Metric({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted">{label}</div>
      <div className={"font-serif italic text-[26px] -tracking-[0.02em] " + (accent ? "text-phos" : "text-ink")}>{v}</div>
    </div>
  );
}
