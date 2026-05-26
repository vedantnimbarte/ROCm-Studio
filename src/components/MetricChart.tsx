import { useMemo } from "react";

interface Props {
  data: number[];
  max?: number;
  color?: string;
  height?: number;
  showAxes?: boolean;
  unit?: string;
}

export default function MetricChart({
  data,
  max = 100,
  color = "#b6ff8a",
  height = 180,
  showAxes = true,
  unit = "%",
}: Props) {
  const { line, area, viewBox } = useMemo(() => {
    const W = 600, H = height, pad = 18;
    const N = Math.max(data.length, 2);
    const xs = (i: number) => pad + (i / (N - 1)) * (W - pad * 2);
    const ys = (v: number) => H - 8 - (Math.max(0, Math.min(max, v)) / max) * (H - 16);
    let line = "";
    let area = `M ${xs(0)} ${H}`;
    if (data.length === 0) {
      line = `M ${xs(0)} ${ys(0)} L ${xs(1)} ${ys(0)}`;
      area = `M ${xs(0)} ${H} L ${xs(1)} ${H} Z`;
    } else {
      data.forEach((v, i) => {
        const x = xs(i).toFixed(1);
        const y = ys(v).toFixed(1);
        line += (i === 0 ? "M" : "L") + x + " " + y + " ";
        area += " L " + x + " " + y;
      });
      area += ` L ${xs(N - 1)} ${H} Z`;
    }
    return { line: line.trim(), area, viewBox: `0 0 ${W} ${H}` };
  }, [data, max, height]);

  const gradId = `g-${color.replace("#", "")}`;
  return (
    <div className="relative w-full h-full bg-bg-2 border border-hairline overflow-hidden"
         style={{ minHeight: height }}>
      <svg viewBox={viewBox} preserveAspectRatio="none" className="w-full h-full block">
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {showAxes && (
          <>
            <line x1="0" y1={height * 0.2} x2="600" y2={height * 0.2} stroke="#22222a" strokeWidth="0.5" />
            <line x1="0" y1={height * 0.4} x2="600" y2={height * 0.4} stroke="#22222a" strokeWidth="0.5" />
            <line x1="0" y1={height * 0.6} x2="600" y2={height * 0.6} stroke="#22222a" strokeWidth="0.5" />
            <line x1="0" y1={height * 0.8} x2="600" y2={height * 0.8} stroke="#22222a" strokeWidth="0.5" />
            <text x="4" y="14" fill="#6c685c" fontFamily="JetBrains Mono" fontSize="8">
              {max}{unit}
            </text>
            <text x="4" y={height - 4} fill="#6c685c" fontFamily="JetBrains Mono" fontSize="8">
              0{unit}
            </text>
            <text x="565" y={height - 4} fill="#6c685c" fontFamily="JetBrains Mono" fontSize="8">
              NOW
            </text>
          </>
        )}
        <path d={area} fill={`url(#${gradId})`} opacity="0.8" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.4"
              style={{ filter: `drop-shadow(0 0 4px ${color}55)` }} />
      </svg>
    </div>
  );
}
