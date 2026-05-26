import { ReactNode } from "react";

interface Props {
  crumb: { label: string; accent?: boolean }[];
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ crumb, title, sub, actions }: Props) {
  return (
    <header className="px-8 pt-7 pb-6 border-b border-hairline grid grid-cols-[1fr_auto] items-end gap-6 relative overflow-hidden"
            style={{ background: "linear-gradient(180deg, rgba(255,58,37,0.04), transparent 70%)" }}>
      <div className="absolute -right-24 -top-12 w-[400px] h-[400px] pointer-events-none"
           style={{ background: "radial-gradient(circle, #ff3a2533, transparent 60%)" }} />
      <div className="relative">
        <div className="font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase mb-3.5 flex items-center gap-2">
          {crumb.map((c, i) => (
            <span key={i} className={c.accent ? "text-red" : i === crumb.length - 1 ? "text-ink-2" : ""}>
              {i > 0 && <span className="mr-2 text-muted">/</span>}
              {c.label}
            </span>
          ))}
        </div>
        <h1 className="font-serif text-[56px] leading-none -tracking-[0.025em]">{title}</h1>
        {sub && <div className="font-mono text-[11.5px] text-ink-2 mt-2.5 tracking-[0.04em]">{sub}</div>}
      </div>
      {actions && <div className="flex gap-2 items-center relative">{actions}</div>}
    </header>
  );
}
