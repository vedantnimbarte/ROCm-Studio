import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

export default function RocmManager() {
  const { data: rocm } = useQuery({ queryKey: ["rocm"], queryFn: api.rocmDetect });
  const { data: plan } = useQuery({ queryKey: ["repair"], queryFn: api.rocmRepair });

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "RUNTIME" }, { label: "ROCm MANAGER · M02", accent: true }]}
        title={<>Runtime,<br /><em className="italic text-red">maintained.</em></>}
        sub={<>Detect installed ROCm/HIP, plan installs and repairs. Destructive actions execute in your shell with full visibility.</>}
        actions={
          <>
            <a className="btn" href="#" onClick={(e) => { e.preventDefault(); api.openExternal("https://rocm.docs.amd.com/"); }}>OPEN DOCS</a>
            <a className="btn primary" href="#" onClick={(e) => { e.preventDefault(); api.openExternal("https://rocm.docs.amd.com/projects/install-on-linux/en/latest/install/quick-start.html"); }}>
              INSTALL GUIDE
            </a>
          </>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel
          className="col-span-7"
          title={<><b>Installation status</b></>}
          meta={rocm?.installed
            ? <span className="pill on">● INSTALLED</span>
            : <span className="pill warn">! MISSING</span>}
        >
          <div className="space-y-3 font-mono text-[12px]">
            <Row k="STATE"  v={rocm?.installed ? "installed" : "not detected"} />
            <Row k="VERSION" v={rocm?.rocm_version || "—"} />
            <Row k="HIP"    v={rocm?.hip_version || "—"} />
            <Row k="PATH"   v={rocm?.install_path || "—"} />
            <Row k="SOURCE" v={rocm?.source || "—"} />
          </div>
          {!rocm?.installed && (
            <div className="mt-5 p-4 border border-amber/40 bg-[rgba(255,182,39,0.06)] font-mono text-[11px] text-ink-2">
              <div className="text-amber tracking-[0.2em] uppercase text-[10px] mb-2">! ACTION REQUIRED</div>
              ROCm is not installed. Use the repair plan on the right or follow the official install
              guide for your platform.
            </div>
          )}
        </Panel>

        <Panel className="col-span-5" title={<><b>Repair plan</b> · dry-run</>} meta={<span>{plan?.steps.length ?? 0} step{(plan?.steps.length ?? 0) === 1 ? "" : "s"}</span>}>
          {plan ? (
            <div className="space-y-3">
              {plan.steps.map((s, i) => (
                <div key={i} className="border-l-2 border-red pl-3">
                  <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted">STEP {String(i+1).padStart(2,"0")}</div>
                  <div className="font-mono text-[12px] text-ink mb-1.5">{s}</div>
                  <pre className="font-mono text-[10.5px] text-phos bg-bg-2 border border-hairline p-2 overflow-x-auto">{plan.commands[i] ?? "—"}</pre>
                </div>
              ))}
              <div className="font-mono text-[10px] text-muted mt-4 leading-relaxed">
                Commands run as <span className="text-amber">your user</span>. Anything requiring sudo will
                prompt in the terminal. Forge will not silently elevate.
              </div>
            </div>
          ) : <div className="text-muted text-[11px] font-mono">computing plan…</div>}
        </Panel>
      </section>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr]">
      <span className="text-muted uppercase text-[9.5px] tracking-[0.18em]">{k}</span>
      <span className="text-ink truncate">{v}</span>
    </div>
  );
}
