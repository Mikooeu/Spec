import { useEffect, useId, useRef, useState } from "react";
import { t } from "../lib/i18n";

/** Winrate selon la durée de la partie : une tranche de 5 min par point (15 = moins de 20 min, 40 = 40 min et plus). */
export type LengthPoint = [number, number, number];   // début de tranche, parties, victoires

const H = 200, L = 40, R = 12, T = 12, B = 26;
// la courbe va d'un bord à l'autre : du milieu de la 1re tranche (< 20 min) au milieu de la dernière (40 min +)
const X0 = 17.5, X1 = 42.5;
const mid = (b: number) => (b <= 15 ? 17.5 : b >= 40 ? 42.5 : b + 2.5);

/** Courbe lisse (Catmull-Rom → Bézier) passant par les points. */
function smooth(p: [number, number][]): string {
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function LengthChart({ points, now, height = H }: { points: LengthPoint[]; now?: number | null; height?: number }) {
  const id = useId().replace(/:/g, "");
  // largeur réelle du conteneur : le texte garde sa taille quelle que soit la largeur de la carte
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const pts = points.filter(([, g]) => g > 0).map(([b, g, w]) => [mid(b), w / g] as [number, number]);
  if (pts.length < 2) return null;
  const h = height;
  const wrs = pts.map((p) => p[1]);
  // échelle : par pas de 2 %, 50 % toujours visible
  const lo = Math.floor(Math.min(0.5, ...wrs) * 50 - 0.0001) / 50, hi = Math.ceil(Math.max(0.5, ...wrs) * 50 + 0.0001) / 50;
  const x = (m: number) => L + ((m - X0) / (X1 - X0)) * (W - L - R);
  const y = (v: number) => h - B - ((v - lo) / (hi - lo)) * (h - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi + 1e-9; v += 0.02) ticks.push(v);
  const xy = pts.map(([m, v]) => [x(m), y(v)] as [number, number]);
  const line = smooth(xy);
  const area = `${line} L ${xy[xy.length - 1][0]} ${h - B} L ${xy[0][0]} ${h - B} Z`;
  const nowX = now != null ? x(Math.min(X1, Math.max(X0, now))) : null;
  const label = (v: number) => `${Math.round(v * 100)} %`;
  return (
    <div ref={box} className="lchart-box">
    <svg className="lchart" width={W} height={h} viewBox={`0 0 ${W} ${h}`} role="img"
         aria-label={t("Winrate de {from} en début de partie à {to} après 40 minutes", { from: label(wrs[0]), to: label(wrs[wrs.length - 1]) })}>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--chart-line)" stopOpacity="0.24" />
          <stop offset="1" stopColor="var(--chart-line)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={Math.abs(v - 0.5) < 1e-6 ? "lchart__mid" : "lchart__grid"} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="lchart__axis">{label(v)}</text>
        </g>
      ))}
      {([[X0, t("< {n} min", { n: 20 }), "start"], [30, t("{n} min", { n: 30 }), "middle"], [X1, t("{n} min +", { n: 40 }), "end"]] as const).map(([m, label, anchor]) => (
        <text key={m} x={x(m)} y={h - 6} textAnchor={anchor} className="lchart__axis">{label}</text>
      ))}
      <path d={area} fill={`url(#lg${id})`} />
      <path d={line} className="lchart__line" />
      {nowX != null && (
        <g className="lchart__now">
          <line x1={nowX} x2={nowX} y1={T} y2={h - B} />
          <text x={nowX + 6} y={T + 10}>{t("Maintenant · {n} min", { n: Math.floor(now!) })}</text>
        </g>
      )}
    </svg>
    </div>
  );
}
