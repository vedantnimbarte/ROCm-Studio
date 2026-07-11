import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

interface DiagSection {
  name: string;
  detail: string;
  ok: boolean;
}
interface DiagPreview {
  sections: DiagSection[];
  estimated_files: number;
}

export default function Diagnostics() {
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const { data: preview, isLoading } = useQuery({
    queryKey: ["diag-preview"],
    queryFn: () => invoke<DiagPreview>("diag_preview"),
  });

  const bundle = useMutation({
    mutationFn: (dest: string) => invoke<string>("diag_bundle", { dest }),
    onSuccess: (p) => setSavedPath(p),
  });

  async function onExport() {
    const path = await save({
      defaultPath: "rocm-forge-diagnostics.zip",
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (path) {
      setSavedPath(null);
      bundle.mutate(path);
    }
  }

  const ready = preview?.sections.filter((s) => s.ok).length ?? 0;

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "TOOLS" }, { label: "DIAGNOSTICS · M13", accent: true }]}
        title={<>Bundle it,<br /><em className="italic text-red">ship it.</em></>}
        sub={<>Collect system, GPU, ROCm and stack details into one zip to attach to a bug report. No secrets — env vars are filtered to ROCm/HIP/PATH only.</>}
        actions={
          <button className="btn primary" onClick={onExport} disabled={bundle.isPending}>
            {bundle.isPending ? "BUILDING…" : "EXPORT BUNDLE"}
          </button>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel
          className="col-span-7"
          title={<><b>Included in the bundle</b></>}
          meta={isLoading ? <span>loading…</span> : <span>{ready}/{preview?.sections.length ?? 0} available</span>}
        >
          <div className="divide-y divide-hairline">
            {preview?.sections.map((s) => (
              <div key={s.name} className="grid grid-cols-[1fr_auto] items-center py-3 font-mono text-[12px]">
                <div>
                  <div className="text-ink">{s.name}</div>
                  <div className="text-muted text-[10px] truncate max-w-[420px]">{s.detail}</div>
                </div>
                <span className={"pill " + (s.ok ? "on" : "off")}>{s.ok ? "ON" : "OFF"}</span>
              </div>
            ))}
            {!preview && !isLoading && (
              <div className="font-mono text-[11px] text-muted py-6 text-center">no preview available</div>
            )}
          </div>
        </Panel>

        <Panel className="col-span-5" title={<><b>Export</b></>}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Tile label="Sections" v={String(preview?.sections.length ?? 0)} />
            <Tile label="Est. files" v={String(preview?.estimated_files ?? 0)} />
          </div>

          {bundle.isError && (
            <div className="mb-3 font-mono text-[11px] text-red">
              {(bundle.error as Error).message}
            </div>
          )}

          {savedPath ? (
            <div className="border border-hairline bg-bg-2 p-3">
              <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted mb-1">Bundle written</div>
              <div className="font-mono text-[11px] text-ink break-all">{savedPath}</div>
            </div>
          ) : (
            <div className="font-mono text-[11px] text-muted leading-relaxed">
              Press <span className="text-ink">EXPORT BUNDLE</span> to choose a destination and write the .zip.
              It contains JSON snapshots of system / GPU / ROCm / environments / AI stack, filtered environment
              variables, and best-effort <span className="text-ink">rocminfo</span>, <span className="text-ink">rocm-smi</span>,
              {" "}<span className="text-ink">hipconfig</span> and <span className="text-ink">uname</span> output.
            </div>
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
