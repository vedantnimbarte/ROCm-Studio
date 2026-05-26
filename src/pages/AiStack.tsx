import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, StackItem } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

export default function AiStack() {
  const qc = useQueryClient();
  const { data: items = [], isFetching } = useQuery({ queryKey: ["stack"], queryFn: api.stackDetect });
  const [log, setLog] = useState<string>("");
  const [running, setRunning] = useState<string | null>(null);

  const install = useMutation({
    mutationFn: async (id: string) => {
      setRunning(id);
      setLog(`$ installing ${id}...\n`);
      const r = await api.stackInstall(id);
      setLog((l) => l + r.output + (r.ok ? "\n\n[ok]" : "\n\n[failed]"));
      return r;
    },
    onSettled: () => { setRunning(null); qc.invalidateQueries({ queryKey: ["stack"] }); },
  });

  const installed = items.filter((i) => i.installed).length;

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "RUNTIME" }, { label: "AI STACK · M05", accent: true }]}
        title={<>One stack,<br /><em className="italic text-red">one click.</em></>}
        sub={<>{installed} of {items.length} installed. Install actions shell out to pip — output appears below.</>}
        actions={<button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ["stack"] })} disabled={isFetching}>RE-SCAN</button>}
      />
      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel className="col-span-7" title={<><b>Detected components</b></>}>
          <div className="divide-y divide-hairline">
            {items.map((it) => (
              <Row key={it.id} it={it}
                   onInstall={() => install.mutate(it.id)}
                   running={running === it.id}
                   onDocs={() => api.openExternal(it.docs_url)} />
            ))}
          </div>
        </Panel>
        <Panel className="col-span-5" title={<><b>Install log</b></>} meta={running && <span className="live-dot">RUNNING</span>}>
          <pre className="font-mono text-[10.5px] text-ink-2 leading-relaxed whitespace-pre-wrap break-words bg-bg-2 border border-hairline p-3 max-h-[460px] overflow-y-auto">
            {log || "$ idle\n  Install or re-scan a component to see output here."}
          </pre>
        </Panel>
      </section>
    </>
  );
}

function Row({ it, onInstall, running, onDocs }: {
  it: StackItem; onInstall: () => void; running: boolean; onDocs: () => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 items-center py-3 font-mono text-[12px]">
      <div className="glyph">{it.name.charAt(0)}</div>
      <div>
        <div className="text-ink">{it.name}</div>
        <div className="text-muted text-[10px] truncate max-w-[420px]">{it.installed ? it.version : it.install_hint}</div>
      </div>
      <span className={"pill " + (it.installed ? "on" : "off")}>{it.installed ? "INSTALLED" : "MISSING"}</span>
      {!it.installed ? (
        <button className="btn" disabled={running} onClick={onInstall}>
          {running ? "INSTALLING…" : "INSTALL"}
        </button>
      ) : <span className="text-muted text-[10px]">—</span>}
      <button className="btn" onClick={onDocs}>DOCS →</button>
    </div>
  );
}
