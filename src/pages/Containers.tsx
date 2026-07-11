import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

interface RuntimeInfo {
  docker: boolean;
  podman: boolean;
  active: string;
  version: string;
}
interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  rocm: boolean;
}
interface ContainerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  rocm: boolean;
}

export default function Containers() {
  const qc = useQueryClient();
  const [pullImage, setPullImage] = useState("");

  const { data: runtime } = useQuery({
    queryKey: ["container-runtime"],
    queryFn: () => invoke<RuntimeInfo>("container_runtime"),
  });
  const active = runtime?.active ?? "";

  const { data: containers = [], isLoading: psLoading, refetch: refetchPs } = useQuery({
    queryKey: ["container-ps"],
    queryFn: () => invoke<Container[]>("container_ps"),
    enabled: !!active,
    refetchInterval: 15_000,
  });
  const { data: images = [], refetch: refetchImages } = useQuery({
    queryKey: ["container-images"],
    queryFn: () => invoke<ContainerImage[]>("container_images"),
    enabled: !!active,
  });

  const act = useMutation({
    mutationFn: (v: { action: string; id: string }) =>
      invoke<string>("container_action", { action: v.action, id: v.id }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["container-ps"] }),
  });
  const pull = useMutation({
    mutationFn: (image: string) => invoke<string>("container_pull", { image }),
    onSettled: () => {
      setPullImage("");
      qc.invalidateQueries({ queryKey: ["container-images"] });
    },
  });

  function rescan() {
    qc.invalidateQueries({ queryKey: ["container-runtime"] });
    refetchPs();
    refetchImages();
  }

  async function onRemove(c: Container) {
    const ok = await confirm(`Remove container "${c.name}"?\n\n${c.image}`, { title: "Confirm", kind: "warning" });
    if (ok) act.mutate({ action: "rm", id: c.id });
  }

  const running = containers.filter((c) => c.state === "running").length;
  const rocmCount = containers.filter((c) => c.rocm).length;

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "TOOLS" }, { label: "CONTAINERS · M12", accent: true }]}
        title={<>Ship in<br /><em className="italic text-red">containers.</em></>}
        sub={
          active ? (
            <>Runtime: <span className="text-ink">{active}</span> · {runtime?.version || "—"}</>
          ) : (
            <>No container runtime detected.</>
          )
        }
        actions={
          <>
            <form
              onSubmit={(e) => { e.preventDefault(); if (pullImage.trim() && active) pull.mutate(pullImage.trim()); }}
              className="flex gap-2 items-center"
            >
              <input className="input w-[220px]" value={pullImage} onChange={(e) => setPullImage(e.target.value)}
                     placeholder="rocm/pytorch:latest" disabled={!active} />
              <button className="btn primary" disabled={!pullImage.trim() || !active || pull.isPending}>
                {pull.isPending ? "PULLING…" : "PULL"}
              </button>
            </form>
            <button className="btn" onClick={rescan}>RE-SCAN</button>
          </>
        }
      />

      {!active ? (
        <section className="p-8">
          <Panel title={<><b>Container runtime</b></>}>
            <div className="font-mono text-[12px] text-muted py-8 text-center">
              <div className="text-red mb-2">Docker / Podman not detected.</div>
              Install Docker (with the ROCm device mounts) or Podman to manage containers here.<br />
              <span className="text-[10px]">e.g. <span className="text-ink">docker run --device=/dev/kfd --device=/dev/dri rocm/pytorch</span></span>
            </div>
          </Panel>
        </section>
      ) : (
        <section className="p-8 grid grid-cols-12 gap-[18px]">
          <Panel
            className="col-span-7"
            title={<><b>Containers</b></>}
            meta={psLoading ? <span>loading…</span> : <span>{running} running · {rocmCount} ROCm · {containers.length} total</span>}
          >
            <div className="border border-hairline bg-bg-2 max-h-[520px] overflow-y-auto">
              <table className="w-full font-mono text-[11px]">
                <thead>
                  <tr className="text-muted uppercase text-[9.5px] tracking-[0.16em]">
                    <th className="text-left p-2 border-b border-hairline">NAME</th>
                    <th className="text-left p-2 border-b border-hairline">IMAGE</th>
                    <th className="text-left p-2 border-b border-hairline">STATE</th>
                    <th className="text-right p-2 border-b border-hairline">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((c) => (
                    <tr key={c.id} className="border-b border-hairline last:border-b-0 hover:bg-panel-2">
                      <td className="p-2">
                        <div className="text-ink">{c.name}</div>
                        <div className="text-muted text-[10px] truncate max-w-[160px]">{c.ports || "—"}</div>
                      </td>
                      <td className="p-2">
                        <span className="text-ink-2">{c.image}</span>
                        {c.rocm && <span className="pill dl ml-1.5">ROCm</span>}
                      </td>
                      <td className="p-2">
                        <span className={"pill " + (c.state === "running" ? "on" : "off")}>{c.state || "—"}</span>
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {c.state === "running" ? (
                          <>
                            <button className="text-ink-2 hover:text-red uppercase tracking-[0.14em] text-[10px] mr-2"
                                    onClick={() => act.mutate({ action: "stop", id: c.id })}>STOP</button>
                            <button className="text-ink-2 hover:text-cyan uppercase tracking-[0.14em] text-[10px] mr-2"
                                    onClick={() => act.mutate({ action: "restart", id: c.id })}>RESTART</button>
                          </>
                        ) : (
                          <button className="text-ink-2 hover:text-cyan uppercase tracking-[0.14em] text-[10px] mr-2"
                                  onClick={() => act.mutate({ action: "start", id: c.id })}>START</button>
                        )}
                        <button className="text-red hover:underline text-[11px]" onClick={() => onRemove(c)}>✕</button>
                      </td>
                    </tr>
                  ))}
                  {containers.length === 0 && !psLoading && (
                    <tr><td colSpan={4} className="p-4 text-center text-muted">no containers — pull an image and run one</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {act.isError && (
              <div className="mt-3 font-mono text-[10px] text-red">{(act.error as Error).message}</div>
            )}
          </Panel>

          <Panel
            className="col-span-5"
            title={<><b>Images</b></>}
            meta={<span>{images.length} local</span>}
          >
            {pull.isError && (
              <div className="font-mono text-[10px] text-red mb-3">{(pull.error as Error).message}</div>
            )}
            <div className="border border-hairline bg-bg-2 max-h-[520px] overflow-y-auto">
              <table className="w-full font-mono text-[11px]">
                <thead>
                  <tr className="text-muted uppercase text-[9.5px] tracking-[0.16em]">
                    <th className="text-left p-2 border-b border-hairline">REPOSITORY:TAG</th>
                    <th className="text-right p-2 border-b border-hairline">SIZE</th>
                  </tr>
                </thead>
                <tbody>
                  {images.map((img) => (
                    <tr key={img.id + img.tag} className="border-b border-hairline last:border-b-0 hover:bg-panel-2">
                      <td className="p-2">
                        <span className="text-ink">{img.repository}<span className="text-muted">:{img.tag}</span></span>
                        {img.rocm && <span className="pill dl ml-1.5">ROCm</span>}
                      </td>
                      <td className="p-2 text-right text-ink-2">{img.size}</td>
                    </tr>
                  ))}
                  {images.length === 0 && (
                    <tr><td colSpan={2} className="p-4 text-center text-muted">no images — pull one above</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}
    </>
  );
}
