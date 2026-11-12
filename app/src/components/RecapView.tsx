import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CDN } from "../lib/ddragon";
import { gameLp, type Game } from "../lib/history";
import { plural, t } from "../lib/i18n";
import { loadRecap, useRoleGuess, type Bar, type Mark, type Recap, type Spot, type Tip } from "../lib/recap";
import { recaps } from "../lib/impact";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, dec1, int, pctN } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const signed = (x: number) => (x > 0 ? `+${int(x)}` : x < 0 ? `−${int(-x)}` : "0");

interface Props {
  stats: Stats;
  game: Game;
  me: string;
  /** Dans le détail d'une partie (historique) plutôt qu'en page entière. */
  embedded?: boolean;
  /** Change quand un écart de LP est enregistré (fin de partie) : la tuile LP se met à jour. */
  lpVersion?: number;
  onClose?: () => void;
}

/** Récap d'une partie terminée (fin de partie dans l'onglet Draft, ou détail d'une partie de l'historique). */
export function RecapView({ stats, game, me, embedded = false, lpVersion = 0, onClose }: Props) {
  const guess = useRoleGuess(stats);
  const [recap, setRecap] = useState<Recap | null | "error" | "none">(null);
  const [focus, setFocus] = useState<number | null>(null);   // moment surligné sur la courbe (« Voir à … min »)
  useEffect(() => {
    let alive = true;
    setRecap(null);
    loadRecap(game.id, me, guess).then((r) => alive && setRecap(r ?? "none")).catch(() => alive && setRecap("error"));
    return () => { alive = false; };
  }, [game.id, me, guess]);
  const lp = useMemo(() => game.lp ?? gameLp(game.id), [game.id, game.lp, lpVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  if (recap === "error") return <p className="game-detail__msg">{t("Le récap passe par le client LoL : ouvre-le, puis réessaie.")}</p>;
  if (recap === "none") return <p className="game-detail__msg">{t("Pas de récap pour cette partie.")}</p>;
  if (!recap) return <div className="skeleton" aria-label={t("Chargement du récap")}>{[0, 1, 2, 3, 4].map((i) => <span key={i} />)}</div>;
  if (recap.remake) return <p className="game-detail__msg">{t("Partie annulée (remake) : pas de récap.")}</p>;

  const r = recap;
  const opp = r.oppChamp != null ? champName(stats, r.oppChamp) : null;
  const fill = (s: string) => s.replace("{opp}", opp ?? t("ton vis-à-vis"));
  const draft = recaps().find((x) => x.game === game.id);
  const tips: Tip[] = [...r.tips];
  if (draft) {
    const me = champName(stats, draft.champ), best = draft.top[0] != null ? champName(stats, draft.top[0]) : null;
    const tip: Tip = draft.rank === 1
      ? { kind: "draft", title: t("{c}, conseil suivi", { c: me }), weight: 0, metric: t("n°1 de Spec"),
          detail: t("C’était le n°1 de Spec dans cette draft.") + (r.laneVerdict === "won" && opp ? ` ${t("Lane gagnée : garde-le face à {opp}.", { opp })}` : "") }
      : { kind: "draft", title: best ? t("Spec conseillait {c}", { c: best }) : t("Hors des conseils de Spec"), weight: 0,
          metric: draft.rank != null ? t("n°{n} de Spec", { n: draft.rank }) : t("Hors conseils"),
          detail: draft.rank != null ? t("{c} était n°{n} de Spec dans cette draft.", { c: me, n: draft.rank }) : t("{c} n’était pas dans les conseils de Spec pour cette draft.", { c: me }) };
    tips.splice(Math.min(tips.length, 2), tips.length, tip);
  }
  const keep = tips.filter((x) => x.kind === "keep").length, work = tips.filter((x) => x.kind === "work").length;
  return (
    <div className={`grecap${embedded ? " grecap--embedded" : ""}`}>
      <section className={`grecap-hero grecap-hero--${r.win ? "win" : "loss"}`}>
        <ChampionIcon stats={stats} champ={r.champ} size={3.5} round />
        <div className="grecap-hero__title">
          <p><strong className={r.win ? "tone-good" : "tone-bad"}>{r.win ? t("Victoire") : t("Défaite")}</strong>
            <span>{champName(stats, r.champ)}{r.role != null ? ` · ${ROLE_LABELS[r.role]}` : ""}</span></p>
          <small>{[game.queueName, clock(r.duration), r.side ? t("côté rouge") : t("côté bleu"), opp ? t("contre {opp}", { opp }) : null].filter(Boolean).join(" · ")}</small>
        </div>
        <div className="grecap-hero__kpis">
          <Kpi label={t("KDA")} value={`${r.kills} / ${r.deaths} / ${r.assists}`} />
          <Kpi label={t("CS/min")} value={dec1(r.csMin)} />
          {r.kp != null && <Kpi label={t("KP")} value={pctN(r.kp)} />}
          {lp != null && <Kpi label={t("LP")} value={signed(lp)} tone={lp >= 0 ? "good" : "bad"} />}
        </div>
        <CopyButton r={r} stats={stats} opp={opp} lp={lp} queue={game.queueName} />
        {onClose && <button className="btn btn--secondary btn--small" onClick={onClose}>{t("Fermer")}</button>}
      </section>

      {r.curve.length >= 4 && <GoldCurve r={r} focus={focus} />}

      <div className="grecap-row">
        <section className="card grecap-card">
          <div className="grecap-head">
            <h2>{t("Ta lane")}</h2>
            <ChampionIcon stats={stats} champ={r.champ} size={1.25} round />
            {r.oppChamp != null && <><span className="muted small">{t("vs")}</span><ChampionIcon stats={stats} champ={r.oppChamp} size={1.25} round /></>}
            <span className="grow" />
            {r.laneVerdict && <span className={`grecap-chip grecap-chip--${r.laneVerdict}`}>
              {r.laneVerdict === "won" ? t("Lane gagnée") : r.laneVerdict === "lost" ? t("Lane perdue") : t("Lane équilibrée")}</span>}
          </div>
          {r.lane ? <div className="grecap-bars">{r.lane.map((b) => <BarRow key={b.label} b={b} />)}</div>
            : <p className="muted small">{t("Vis-à-vis non identifié sur cette partie.")}</p>}
        </section>
        <PositionCard stats={stats} r={r} />
      </div>

      {tips.length > 0 && (
        <section className="card grecap-card grecap-tips">
          <div className="grecap-head">
            <h2>{t("À retenir pour la prochaine")}</h2><span className="grow" />
            {(keep > 0 || work > 0) && <span className="muted small">{[keep ? plural(keep, "{n} à garder", "{n} à garder") : null, work ? plural(work, "{n} à travailler", "{n} à travailler") : null].filter(Boolean).join(" · ")}</span>}
          </div>
          <ul className="grecap-tips__list">
            {tips.map((p) => (
              <li key={p.title} className={`grecap-tip grecap-tip--${p.kind}`}>
                <div className="grecap-tip__text">
                  <p><span className="grecap-tip__kind">{p.kind === "keep" ? t("À garder") : p.kind === "work" ? t("À travailler") : t("Draft")}</span><strong>{fill(p.title)}</strong></p>
                  <small>{fill(p.detail)}</small>
                </div>
                <div className="grecap-tip__side">
                  {p.metric && <span className="grecap-tip__metric">{fill(p.metric)}</span>}
                  {p.at != null && r.curve.length >= 4 && (
                    <button className="link-btn" onClick={() => { setFocus(p.at!); document.querySelector(".grecap-curve")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                      {t("Voir à {m} min", { m: Math.floor(p.at) })} ›</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** « Copier » : le récap en image (à coller sur Discord), ou en texte si le presse-papiers refuse l'image. */
function CopyButton({ r, stats, opp, lp, queue }: { r: Recap; stats: Stats; opp: string | null; lp: number | null; queue?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const title = `${r.win ? t("Victoire") : t("Défaite")} · ${champName(stats, r.champ)}${r.role != null ? ` ${ROLE_LABELS[r.role]}` : ""}`;
    const sub = [queue, clock(r.duration), opp ? t("contre {opp}", { opp }) : null].filter(Boolean).join(" · ");
    const kpis: [string, string, string?][] = [[t("KDA"), `${r.kills} / ${r.deaths} / ${r.assists}`], [t("CS/min"), dec1(r.csMin)]];
    if (r.kp != null) kpis.push([t("KP"), pctN(r.kp)]);
    if (lp != null) kpis.push([t("LP"), signed(lp), lp >= 0 ? "#30d158" : "#ff6259"]);
    try {
      const blob = await recapImage(r, title, sub, kpis);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      try { await navigator.clipboard.writeText(`${title}\n${sub}\n${kpis.map(([k, v]) => `${k} ${v}`).join(" · ")}\n— Spec`); } catch { return; }
    }
    setDone(true); window.setTimeout(() => setDone(false), 2000);
  };
  return <button className="btn btn--secondary btn--small" onClick={copy} title={t("Copie le récap en image, à coller sur Discord")}>{done ? t("Copié ✓") : t("Copier")}</button>;
}

/** Carte 1200 × 630 : résultat, chiffres clés et courbe d'or. Dessinée à la main, sans image externe. */
export async function recapImage(r: Recap, title: string, sub: string, kpis: [string, string, string?][]): Promise<Blob> {
  const W = 1200, H = 630, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const F = (w: number, size: number) => `${w} ${size}px Inter, "Segoe UI", sans-serif`;
  g.fillStyle = "#0b0b0f"; g.fillRect(0, 0, W, H);
  const rr = (x: number, y: number, w: number, h: number, rad: number, fill: string) => { g.beginPath(); g.roundRect(x, y, w, h, rad); g.fillStyle = fill; g.fill(); };
  rr(40, 40, W - 80, H - 80, 28, "#1c1c1f");
  g.fillStyle = r.win ? "#30d158" : "#ff6259"; g.font = F(700, 52); g.fillText(title, 84, 128);
  g.fillStyle = "#a1a1a6"; g.font = F(400, 26); g.fillText(sub, 84, 172);
  kpis.forEach(([k, v, col], i) => {
    const x = 84 + i * 258; rr(x, 210, 240, 108, 18, "#26262a");
    g.fillStyle = "#98989d"; g.font = F(500, 22); g.fillText(k, x + 22, 250);
    g.fillStyle = col ?? "#f5f5f7"; g.font = F(700, 36); g.fillText(v, x + 22, 296);
  });
  // courbe d'or
  const pts = r.curve, X0 = 84, X1 = W - 84, Y0 = 370, Y1 = 496;   // la courbe s’arrête bien au-dessus du pied (Spec · verdict)
  if (pts.length >= 2) {
    const end = pts[pts.length - 1].min || 1;
    const hi = Math.max(600, ...pts.map((p) => p.gold)), lo = Math.min(-600, ...pts.map((p) => p.gold));
    const x = (m: number) => X0 + (X1 - X0) * (m / end), y = (v: number) => Y0 + (Y1 - Y0) * ((hi - v) / (hi - lo));
    g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 2; g.setLineDash([8, 8]);
    g.beginPath(); g.moveTo(X0, y(0)); g.lineTo(X1, y(0)); g.stroke(); g.setLineDash([]);
    for (const [clipTop, col] of [[true, "#409cff"], [false, "#ff6259"]] as const) {
      g.save(); g.beginPath();
      if (clipTop) g.rect(0, 0, W, y(0)); else g.rect(0, y(0), W, H);
      g.clip(); g.strokeStyle = col; g.lineWidth = 5; g.lineJoin = "round"; g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(x(p.min), y(p.gold)) : g.moveTo(x(p.min), y(p.gold))));
      g.stroke(); g.restore();
    }
    g.fillStyle = "#98989d"; g.font = F(500, 20); g.fillText(t("Écart d’or de ton équipe"), X0, Y0 - 12);
  }
  g.fillStyle = "#f5f5f7"; g.font = F(700, 26); g.fillText("Spec", 84, H - 66);
  if (r.laneVerdict) {
    const v = r.laneVerdict === "won" ? t("Lane gagnée") : r.laneVerdict === "lost" ? t("Lane perdue") : t("Lane équilibrée");
    g.font = F(600, 22); g.fillStyle = r.laneVerdict === "won" ? "#30d158" : r.laneVerdict === "lost" ? "#ff6259" : "#a1a1a6";
    g.textAlign = "right"; g.fillText(v, W - 84, H - 66); g.textAlign = "left";
  }
  return await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("toBlob"))), "image/png"));
}

function BarRow({ b }: { b: Bar }) {
  const tot = b.me + b.opp;
  return (
    <div className="grecap-bar">
      <p><span>{b.label}</span><strong className="grecap-bar__me">{int(b.me)}</strong><span className="muted">–</span><strong className="tone-bad">{int(b.opp)}</strong></p>
      <div className="grecap-bar__track" aria-hidden="true">
        <span style={{ flexGrow: tot ? b.me : 1 }} /><span style={{ flexGrow: tot ? b.opp : 1 }} />
      </div>
    </div>
  );
}

const MARK_LABEL: Record<Mark["kind"], () => string> = {
  kill: () => t("Kill"), death: () => t("Mort"), dragon: () => t("Dragon"), tower: () => t("Tour"), baron: () => t("Nashor"), herald: () => t("Héraut"),
};

/** Écart d'or de ton équipe sur toute la partie, découpé en phases, avec tes kills et tes morts et les objectifs des deux équipes. */
function GoldCurve({ r, focus }: { r: Recap; focus: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const end = r.duration / 60;
  const objs = r.marks.filter((m) => m.kind !== "kill" && m.kind !== "death");
  // échelle asymétrique : toute la hauteur sert, le 0 se place selon l'écart le plus haut et le plus bas
  const W = 900, L = 40, R = 8, T = 30, B = 150, OA = 170, OB = 188, H = objs.length ? 212 : 172;
  const hi = Math.max(600, ...r.curve.map((p) => p.gold)) * 1.1, lo = Math.min(-600, ...r.curve.map((p) => p.gold)) * 1.1;
  const x = (m: number) => L + (W - L - R) * Math.min(1, m / end);
  const y = (g: number) => T + (B - T) * ((hi - g) / (hi - lo));
  const goldAt = (m: number) => {
    const c = r.curve; const i = c.findIndex((p) => p.min >= m);
    if (i <= 0) return c[Math.max(0, i)].gold;
    const a = c[i - 1], b = c[i]; return a.gold + (b.gold - a.gold) * ((m - a.min) / (b.min - a.min || 1));
  };
  const d = r.curve.map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)} ${y(p.gold).toFixed(1)}`).join(" ");
  const phases: [string, number, number][] = end > 27 ? [[t("Lane"), 0, 15], [t("Milieu"), 15, 25], [t("Fin"), 25, end]]
    : end > 17 ? [[t("Lane"), 0, 15], [t("Fin"), 15, end]] : [[t("Lane"), 0, end]];
  const ticks = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].filter((m) => m < end - 1.5);
  const onCurve = r.marks.filter((m) => m.kind === "kill" || m.kind === "death");
  const h = hover != null ? r.curve[hover] : null;
  const legend = (["kill", "death", "dragon", "tower", "baron", "herald"] as Mark["kind"][]).filter((k) => r.marks.some((m) => m.kind === k));
  return (
    <section className="card grecap-card">
      <div className="grecap-head">
        <h2>{t("Écart d’or de ton équipe")}</h2>
        <span className="grow" />
        <span className="grecap-curve__legend">{legend.map((k) => <span key={k}><i className={`mk mk--${k}`} />{MARK_LABEL[k]()}</span>)}</span>
      </div>
      <div className="grecap-curve" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Écart d’or de ton équipe pendant la partie")}>
          <defs>
            <clipPath id="gc-up"><rect x="0" y="0" width={W} height={y(0)} /></clipPath>
            <clipPath id="gc-down"><rect x="0" y={y(0)} width={W} height={H} /></clipPath>
          </defs>
          {phases.map(([label, a, b], i) => (
            <g key={label}>
              <rect x={x(a) + (i ? 2 : 0)} y={4} width={x(b) - x(a) - (i ? 2 : 0)} height={B - 4} rx={8} className={i ? "grecap-curve__phase" : "grecap-curve__phase is-first"} />
              <text x={x(a) + 10} y={20} className="grecap-curve__plabel">{label} · {Math.round(a)}–{Math.round(b)} min</text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="grecap-curve__zero" />
          <text x={L - 8} y={y(0) + 4} textAnchor="end" className="grecap-curve__axis">0</text>
          <path d={d} className="grecap-curve__line is-up" clipPath="url(#gc-up)" />
          <path d={d} className="grecap-curve__line is-down" clipPath="url(#gc-down)" />
          {focus != null && <rect x={x(Math.max(0, focus - 1))} y={4} width={Math.max(6, x(Math.min(end, focus + 1)) - x(Math.max(0, focus - 1)))} height={B - 4} rx={6} className="grecap-curve__focus" />}
          {hover != null && h && <line x1={x(h.min)} x2={x(h.min)} y1={4} y2={B} className="grecap-curve__cursor" />}
          {onCurve.map((m, i) => <circle key={`c${i}`} cx={x(m.min)} cy={y(goldAt(m.min))} r={5} className={`mk mk--${m.kind}`}><title>{`${MARK_LABEL[m.kind]()} · ${Math.floor(m.min)} min`}</title></circle>)}
          {objs.length > 0 && <>
            <text x={L - 8} y={OA + 4} textAnchor="end" className="grecap-curve__axis">{t("Vous")}</text>
            <text x={L - 8} y={OB + 4} textAnchor="end" className="grecap-curve__axis">{t("Eux")}</text>
          </>}
          {objs.map((m, i) => <circle key={`o${i}`} cx={x(m.min)} cy={m.ally ? OA : OB} r={4.5} className={`mk mk--${m.kind}`}><title>{`${MARK_LABEL[m.kind]()} · ${Math.floor(m.min)} min`}</title></circle>)}
          {ticks.map((m) => <text key={m} x={x(m)} y={H - 2} textAnchor={m ? "middle" : "start"} className="grecap-curve__axis">{m}</text>)}
          {r.curve.map((p, i) => <rect key={`h${i}`} x={x(p.min) - 8} y={4} width={16} height={B - 4} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
        {r.turn && hover == null && (
          <div className="grecap-curve__note" style={{ left: `${(x(r.turn.min) / W) * 100}%`, top: `${(y(goldAt(r.turn.min)) / H) * 100}%` }}>
            <strong>{t("{m} min · le tournant", { m: r.turn.min })}</strong><small>{r.turn.detail}</small>
          </div>
        )}
        {h && (
          <div className="grecap-curve__note is-hover" style={{ left: `${(x(h.min) / W) * 100}%`, top: `${(y(h.gold) / H) * 100}%` }}>
            <strong>{t("{m} min", { m: Math.round(h.min) })}</strong><small className={h.gold >= 0 ? "tone-good" : "tone-bad"}>{signed(h.gold)} {t("d’or")}</small>
          </div>
        )}
      </div>
    </section>
  );
}

/** Petite carte de tes déplacements ; « Agrandir » ouvre la carte complète avec les périodes. */
function PositionCard({ stats, r }: { stats: Stats; r: Recap }) {
  const [big, setBig] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext("2d");
    if (c && ctx) drawHeat(ctx, c.width, r.heat.path);
  }, [r]);
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [big]);
  const zones = r.zones.length === 2 ? t("Surtout {a} et {b}.", { a: r.zones[0], b: r.zones[1] }) : r.zones.length ? t("Surtout {a}.", { a: r.zones[0] }) : "";
  return (
    <section className="card grecap-card grecap-pos">
      <div className="grecap-head"><h2>{t("Ta position")}</h2><span className="grow" />
        {r.heat.path.length > 0 && <button className="link-btn" onClick={() => setBig(true)}>{t("Agrandir")}</button>}</div>
      <button className="grecap-map grecap-map--small" onClick={() => setBig(true)} disabled={!r.heat.path.length} aria-label={t("Agrandir la carte")}>
        <img src={`${CDN}/${stats.ddragon}/img/map/map11.png`} alt="" />
        <canvas ref={canvas} width={256} height={256} />
        {!r.heat.path.length && <p className="grecap-map__empty">{t("Pas de positions pour cette partie.")}</p>}
      </button>
      {zones && <small className="muted">{zones}</small>}
      {/* portail : les animations d’entrée (transform) des cartes enfermeraient la fenêtre dans la carte */}
      {big && createPortal(
        <div className="grecap-modal" role="dialog" aria-modal="true" aria-label={t("Ta position")} onClick={() => setBig(false)}>
          <div className="card grecap-card grecap-modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="grecap-head"><h2>{t("Tes déplacements")}</h2><span className="grow" /><button className="btn btn--secondary btn--small" autoFocus onClick={() => setBig(false)}>{t("Fermer")}</button></div>
            <Heatmap stats={stats} heat={r.heat} side={r.side} duration={r.duration} />
          </div>
        </div>, document.body)}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className="grecap-kpi"><small>{label}</small><strong className={tone ? `tone-${tone}` : ""}>{value}</strong></div>;
}

type Period = "all" | "early" | "late";

function Heatmap({ stats, heat, side, duration }: { stats: Stats; heat: Recap["heat"]; side: 0 | 1; duration: number }) {
  const [period, setPeriod] = useState<Period>("all");
  const canvas = useRef<HTMLCanvasElement>(null);
  const keep = (s: Spot) => period === "all" || (period === "early" ? s.min < 15 : s.min >= 15);
  const path = heat.path.filter(keep), kills = heat.kills.filter(keep), deaths = heat.deaths.filter(keep);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    drawHeat(ctx, c.width, path);
  }, [period, heat]); // eslint-disable-line react-hooks/exhaustive-deps
  const periods: [Period, string][] = [["all", t("Toute la partie")], ["early", t("0–15 min")], ["late", t("Après 15 min")]];
  return (
    <>
      <Segmented className="segmented grecap-period" role="tablist" aria-label={t("Période")}>
        {periods.map(([p, label]) => (
          <button key={p} role="tab" aria-selected={period === p} className={period === p ? "is-active" : ""}
                  disabled={p === "late" && duration < 15 * 60} onClick={() => setPeriod(p)}>{label}</button>
        ))}
      </Segmented>
      <div className="grecap-map">
        <img src={`${CDN}/${stats.ddragon}/img/map/map11.png`} alt="" />
        <canvas ref={canvas} width={256} height={256} />
        {kills.map((s, i) => <span key={`k${i}`} className="grecap-map__dot grecap-map__dot--kill" style={{ left: `${s.x * 100}%`, top: `${(1 - s.y) * 100}%` }} />)}
        {deaths.map((s, i) => <span key={`d${i}`} className="grecap-map__dot grecap-map__dot--death" style={{ left: `${s.x * 100}%`, top: `${(1 - s.y) * 100}%` }} />)}
        {!path.length && <p className="grecap-map__empty">{t("Pas de positions pour cette période.")}</p>}
      </div>
      <div className="grecap-legend">
        <span><i className="grecap-legend__heat" />{t("Présence")}</span>
        <span><i className="grecap-legend__kill" />{t("Kills")}</span>
        <span><i className="grecap-legend__death" />{t("Morts")}</span>
        <span className="muted">{side ? t("Côté rouge (en haut à droite)") : t("Côté bleu (en bas à gauche)")}</span>
      </div>
      <small className="muted">{t("Ta position toutes les minutes, plus tes kills et tes morts.")}</small>
    </>
  );
}

/** Carte de chaleur : on accumule des taches floues en niveaux de gris, puis on colore (jaune → orange → rouge). */
function drawHeat(ctx: CanvasRenderingContext2D, size: number, spots: Spot[]) {
  ctx.clearRect(0, 0, size, size);
  const r = size * 0.075;
  for (const s of spots) {
    const x = s.x * size, y = (1 - s.y) * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.32)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    const k = Math.min(1, a * 1.4);
    d[i] = 255;
    d[i + 1] = Math.round(220 - 170 * k);
    d[i + 2] = Math.round(60 - 50 * k);
    d[i + 3] = Math.round(Math.min(0.85, 0.25 + k * 0.7) * 255);
  }
  ctx.putImageData(img, 0, 0);
}
