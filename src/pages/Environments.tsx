import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirm } from "@tauri-apps/plugin-dialog";
import { api, PyEnv } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

export default function Environments() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<PyEnv | null>(null);
  const [newName, setNewName] = useState("");

  const { data: envs = [], isLoading } = useQuery({ queryKey: ["envs"], queryFn: api.envList });
  const { data: pkgs = [] } = useQuery({
    queryKey: ["pkgs", selected?.path],
    queryFn: () => api.envPackages(selected!.path),
    enabled: !!selected,
  });

  const create = useMutation({
    mutationFn: (name: string) => api.envCreate(name),
    onSuccess: () => { setNewName(""); qc.invalidateQueries({ queryKey: ["envs"] }); },
  });
  const del = useMutation({
    mutationFn: (path: string) => api.envDelete(path),
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ["envs"] }); },
  });

  async function onDelete(env: PyEnv) {
    const ok = await confirm(`Delete environment "${env.name}"?\n\n${env.path}`, { title: "Confirm", kind: "warning" });
    if (ok) del.mutate(env.path);
  }

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "RUNTIME" }, { label: "ENVIRONMENTS · M04", accent: true }]}
        title={<>Python,<br /><em className="italic text-red">isolated.</em></>}
        sub={<>Discovered {envs.length} environment{envs.length === 1 ? "" : "s"} across ~/envs, ~/.virtualenvs and conda.</>}
        actions={
          <form
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); }}
            className="flex gap-2 items-center"
          >
            <input className="input w-[220px]" value={newName} onChange={(e) => setNewName(e.target.value)}
                   placeholder="new-env-name" />
            <button className="btn primary" disabled={!newName.trim() || create.isPending}>
              {create.isPending ? "CREATING…" : "+ CREATE VENV"}
            </button>
          </form>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel className="col-span-5" title={<><b>Environments</b></>} meta={isLoading ? <span>loading…</span> : <span>{envs.length} total</span>}>
          <div className="divide-y divide-hairline">
            {envs.map((e) => (
              <button key={e.path}
                      onClick={() => setSelected(e)}
                      className={`w-full text-left grid grid-cols-[1fr_auto] items-center py-3 transition hover:bg-bg-2 -mx-[18px] px-[18px] ${selected?.path === e.path ? "bg-[rgba(255,58,37,0.05)] border-l-2 border-red" : ""}`}>
                <div>
                  <div className="font-mono text-[12px] text-ink">{e.name}</div>
                  <div className="font-mono text-[10px] text-muted truncate max-w-[340px]">{e.path}</div>
                </div>
                <div className="text-right">
                  <span className={"pill " + (e.kind === "conda" ? "dl" : "on")}>{e.kind}</span>
                  <div className="font-mono text-[10px] text-muted mt-1">py {e.python_version}</div>
                </div>
              </button>
            ))}
            {envs.length === 0 && !isLoading && (
              <div className="font-mono text-[11px] text-muted py-6 text-center">
                no environments detected — create one →
              </div>
            )}
          </div>
          {create.isError && (
            <div className="mt-3 font-mono text-[11px] text-red">
              {(create.error as Error).message}
            </div>
          )}
        </Panel>

        <Panel
          className="col-span-7"
          title={selected ? <><b>{selected.name}</b> · packages</> : <><b>Detail</b></>}
          meta={selected && (
            <button onClick={() => onDelete(selected)} className="font-mono text-[10px] uppercase tracking-[0.18em] text-red hover:underline">
              ✕ DELETE
            </button>
          )}
        >
          {!selected ? (
            <div className="font-mono text-[11px] text-muted">Select an environment on the left to inspect its installed packages.</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <Tile label="Python" v={selected.python_version} />
                <Tile label="Kind" v={selected.kind} />
                <Tile label="Packages" v={String(pkgs.length || selected.packages || 0)} />
              </div>
              <div className="border border-hairline bg-bg-2 max-h-[420px] overflow-y-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="text-muted uppercase text-[9.5px] tracking-[0.16em]">
                      <th className="text-left p-2 border-b border-hairline">PACKAGE</th>
                      <th className="text-right p-2 border-b border-hairline">VERSION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkgs.map(([n, v]) => (
                      <tr key={n} className="border-b border-hairline last:border-b-0">
                        <td className="p-2 text-ink">{n}</td>
                        <td className="p-2 text-right text-muted">{v}</td>
                      </tr>
                    ))}
                    {pkgs.length === 0 && (
                      <tr><td colSpan={2} className="p-4 text-center text-muted">no packages found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </section>
    </>
  );
}

function Tile({ label, v }: { label: string; v: string }) {
  return (
    <div className="border border-hairline bg-bg-2 px-3 py-2.5">
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted">{label}</div>
      <div className="font-mono text-[16px] text-ink mt-1">{v}</div>
    </div>
  );
}
