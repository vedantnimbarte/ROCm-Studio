import { ReactNode } from "react";

interface Props {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  noBody?: boolean;
}

export default function Panel({ title, meta, children, className = "", bodyClass = "", noBody }: Props) {
  return (
    <article className={`panel ${className}`}>
      <span className="corner tl" /><span className="corner tr" />
      <span className="corner bl" /><span className="corner br" />
      <div className="panel-head">
        <div className="title">{title}</div>
        {meta && <div className="flex gap-3 items-center">{meta}</div>}
      </div>
      {noBody ? children : <div className={`panel-body ${bodyClass}`}>{children}</div>}
    </article>
  );
}
