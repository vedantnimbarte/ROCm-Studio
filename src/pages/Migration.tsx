import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

interface Finding {
  file: string;
  line: number;
  snippet: string;
  cuda: string;
  hip: string;
  category: string;
  auto: boolean;
}
interface CategoryCount {
  category: string;
  count: number;
}
interface ScanReport {
  root: string;
  files_scanned: number;
  findings: Finding[];
  by_category: CategoryCount[];
  capped: boolean;
}
interface HipifyStatus {
  available: boolean;
  tool: string;
}

export default function Migration() {
  const [hipify, setHipify] = useState<HipifyStatus | null>(null);

  const scan = useMutation({
    mutationFn: (dir: string) => invoke<ScanReport>("migrate_scan", { dir }),
    onSuccess: () => {
      invoke<HipifyStatus>("migrate_hipify_available").then(setHipify).catch(() => setHipify(null));
    },
  });

  const convert = useMutation({
    mutationFn: (path: string) => invoke<string>("migrate_hipify", { path }),
  });

  async function pickFolder() {
    const dir = await open({ directory: true });
    if (dir) scan.mutate(dir as string);
  }

  const report = scan.data;

  return (
    <>
      <PageHeader
        crumb={[{ label: "FORGE" }, { label: "TOOLS" }, { label: "MIGRATION · M11", accent: true }]}
        title={<>Port to<br /><em className="italic text-red">ROCm.</em></>}
        sub={<>Static CUDA → HIP scan. No ROCm required to inspect; install it to one-click convert a file.</>}
        actions={
          <button className="btn primary" onClick={pickFolder} disabled={scan.isPending}>
            {scan.isPending ? "SCANNING…" : "SELECT FOLDER"}
          </button>
        }
      />

      <section className="p-8 grid grid-cols-12 gap-[18px]">
        <Panel
          className="col-span-8"
          title={<><b>Findings</b></>}
          meta={report && <span className="font-mono text-[10px] text-muted">{report.findings.length} hits</span>}
        >
          {scan.isPending ? (
            <div className="font-mono text-[11px] text-muted py-8 text-center">scanning source tree…</div>
          ) : scan.isError ? (
            <div className="font-mono text-[11px] text-red py-6">{(scan.error as Error).message}</div>
          ) : !report ? (
            <div className="font-mono text-[11px] text-muted py-8 text-center">
              Select a source folder to scan for CUDA API usage →
            </div>
          ) : report.findings.length === 0 ? (
            <div className="font-mono text-[11px] text-muted py-8 text-center">
              no CUDA usage found in {report.files_scanned} file{report.files_scanned === 1 ? "" : "s"} — nothing to port.
            </div>
          ) : (
            <div className="border border-hairline bg-bg-2 max-h-[520px] overflow-y-auto">
              <table className="w-full font-mono text-[11px]">
                <thead className="sticky top-0 bg-bg-2">
                  <tr className="text-muted uppercase text-[9.5px] tracking-[0.16em]">
                    <th className="text-left p-2 border-b border-hairline">FILE:LINE</th>
                    <th className="text-left p-2 border-b border-hairline">CUDA</th>
                    <th className="text-center p-2 border-b border-hairline">→</th>
                    <th className="text-left p-2 border-b border-hairline">HIP</th>
                    <th className="text-right p-2 border-b border-hairline">CATEGORY</th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.map((f, i) => (
                    <tr key={i} className="border-b border-hairline last:border-b-0 align-top">
                      <td className="p-2 text-muted whitespace-nowrap" title={f.snippet}>
                        {f.file}:{f.line}
                      </td>
                      <td className="p-2 text-ink">{f.cuda}</td>
                      <td className="p-2 text-center text-red">→</td>
                      <td className="p-2 text-ink-2">{f.hip}</td>
                      <td className="p-2 text-right">
                        <span className={"pill " + (f.auto ? "on" : "warn")}>{f.category}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report?.capped && (
            <div className="mt-3 font-mono text-[10px] text-red">
              ⚠ results capped — the source tree is large; showing a partial scan.
            </div>
          )}
        </Panel>

        <Panel className="col-span-4" title={<><b>Summary</b></>}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Tile label="Files scanned" v={report ? String(report.files_scanned) : "—"} />
            <Tile label="Findings" v={report ? String(report.findings.length) : "—"} />
          </div>

          <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted mb-2">By category</div>
          <div className="border border-hairline bg-bg-2 mb-4">
            {report && report.by_category.length > 0 ? (
              report.by_category.map((c) => (
                <div key={c.category} className="flex justify-between px-3 py-1.5 border-b border-hairline last:border-b-0 font-mono text-[11px]">
                  <span className="text-ink-2">{c.category}</span>
                  <span className="text-muted">{c.count}</span>
                </div>
              ))
            ) : (
              <div className="px-3 py-2 font-mono text-[10px] text-muted">no data yet</div>
            )}
          </div>

          <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted mb-2">Auto-conversion</div>
          <div className="border border-hairline bg-bg-2 px-3 py-2.5 mb-3">
            {hipify === null ? (
              <span className="font-mono text-[10px] text-muted">unknown — run a scan</span>
            ) : hipify.available ? (
              <div className="flex items-center gap-2">
                <span className="pill on">READY</span>
                <span className="font-mono text-[10px] text-ink-2">{hipify.tool}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="pill off">UNAVAILABLE</span>
                <span className="font-mono text-[10px] text-muted">hipify-perl not found</span>
              </div>
            )}
          </div>

          {hipify?.available && (
            <button
              className="btn primary w-full"
              disabled={convert.isPending}
              onClick={async () => {
                const path = await open({ directory: false });
                if (path) convert.mutate(path as string);
              }}
            >
              {convert.isPending ? "CONVERTING…" : "HIPIFY A FILE (DRY-RUN)"}
            </button>
          )}

          {convert.isError && (
            <div className="mt-2 font-mono text-[10px] text-red">{(convert.error as Error).message}</div>
          )}
          {convert.data && (
            <pre className="mt-3 font-mono text-[10px] text-ink-2 leading-relaxed whitespace-pre-wrap break-words bg-bg-2 border border-hairline p-3 max-h-[240px] overflow-y-auto">
              {convert.data}
            </pre>
          )}

          <div className="mt-4 font-mono text-[10px] text-muted leading-relaxed">
            <span className="pill warn">warn</span> markers need manual review — library and API-shape changes are
            not a straight rename. Hipify is a dry-run: it prints the translation and never modifies your source.
          </div>
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
