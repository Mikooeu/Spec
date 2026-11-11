import { useEffect, useMemo, useRef, useState } from "react";
import { CDN } from "../lib/ddragon";
import { gameLp, type Game } from "../lib/history";
import { t } from "../lib/i18n";
import { loadRecap, useRoleGuess, type Duel, type Point, type Recap, type Spot } from "../lib/recap";
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
  return (
    <div className={`grecap${embedded ? " grecap--embedded" : ""}`}>
      <section className={`grecap-hero grecap-hero--${r.win ? "win" : "loss"}`}>
        <ChampionIcon stats={stats} champ={r.champ} size={3.5} round />
        <div className="grecap-hero__title">
          <p><strong className={r.win ? "tone-good" : "tone-bad"}>{r.win ? t("Victoire") : t("Défaite")}</strong>
            <span>{champName(stats, r.champ)}{r.role != null ? ` · ${ROLE_LABELS[r.role]}` : ""}</span></p>
          <small>{game.queueName} · {clock(r.duration)} · {r.side ? t("Côté rouge") : t("Côté bleu")}</small>
        </div>
        <div className="grecap-hero__kpis">
          <Kpi label={t("KDA")} value={`${r.kills} / ${r.deaths} / ${r.assists}`} />
          <Kpi label={t("CS/min")} value={dec1(r.csMin)} />
          {r.kp != null && <Kpi label={t("KP")} value={pctN(r.kp)} />}
          {lp != null && <Kpi label={t("LP")} value={signed(lp)} tone={lp >= 0 ? "good" : "bad"} />}
        </div>
        {onClose && <button className="btn btn--secondary btn--small" onClick={onClose}>{t("Fermer")}</button>}
      </section>

      <section className="card grecap-card">
        <h2>{t("Ta lane")}<small>{opp ? t("face à {opp}", { opp }) : t("vis-à-vis non identifié")}</small></h2>
        <div className="grecap-lane">
          {r.at15 ? <DuelTile title={t("À 15 min")} rows={r.at15} opp={opp} />
            : <div className="grecap-tile grecap-tile--empty">{t("La partie s’est terminée avant 15 min.")}</div>}
          <DuelTile title={t("Fin de partie")} rows={r.end} opp={opp} />
        </div>
      </section>

      <section className="card grecap-card">
        <h2>{t("Ton équipe")}</h2>
        <div className="grecap-team">
          <GoldTile label={t("Écart d’or à 15 min")} value={r.team.gold15} />
          <GoldTile label={t("Écart d’or en fin")} value={r.team.goldEnd} />
          <Versus label={t("Kills")} v={r.team.kills} />
          <Versus label={t("Tours")} v={r.team.towers} />
          <Versus label={t("Dragons")} v={r.team.dragons} />
          <Versus label={t("Nashor")} v={r.team.barons} />
          <Versus label={t("Héraut")} v={r.team.heralds} />
        </div>
      </section>

      <div className="grecap-row">
        <section className="card grecap-card">
          <h2>{t("Ce qui a joué")}</h2>
          {r.brief && <div className="grecap-tile grecap-brief"><small>{t("En bref")}</small><p>{fill(r.brief)}</p></div>}
          <div className="grecap-why">
            <Points title={t("En ta faveur")} tone="good" points={r.good} fill={fill} />
            <Points title={t("En ta défaveur")} tone="bad" points={r.bad} fill={fill} />
          </div>
        </section>
        <section className="card grecap-card grecap-moves">
          <h2>{t("Tes déplacements")}</h2>
          <Heatmap stats={stats} heat={r.heat} side={r.side} duration={r.duration} />
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className="grecap-kpi"><small>{label}</small><strong className={tone ? `tone-${tone}` : ""}>{value}</strong></div>;
}

function DuelTile({ title, rows, opp }: { title: string; rows: Duel[]; opp: string | null }) {
  return (
    <div className={`grecap-tile grecap-duel${opp ? "" : " grecap-duel--solo"}`}>
      <div className="grecap-duel__row grecap-duel__head">
        <strong>{title}</strong><span>{t("Toi")}</span>{opp && <><span>{opp}</span><span>{t("Écart")}</span></>}
      </div>
      {rows.map((d) => (
        <div key={d.label} className="grecap-duel__row">
          <span className="grecap-duel__label">{d.label}</span>
          <strong>{d.me}</strong>
          {opp && <><span className="muted">{d.opp ?? "—"}</span>
            <span>{d.diff != null && <span className={`grecap-pill tone-${d.good ? "good" : "bad"}`}>{d.diff}</span>}</span></>}
        </div>
      ))}
    </div>
  );
}

function GoldTile({ label, value }: { label: string; value: number | null }) {
  const tone = value == null ? "" : value >= 0 ? "good" : "bad";
  const note = value == null ? t("Timeline indisponible") : label === t("Écart d’or à 15 min")
    ? (value >= 1500 ? t("Devant après la phase de lane") : value <= -1500 ? t("En retard après la phase de lane") : t("Équilibré après la phase de lane"))
    : (value >= 0 ? t("Devant en fin de partie") : t("En retard en fin de partie"));
  return (
    <div className="grecap-tile grecap-gold">
      <small>{label}</small>
      <strong className={tone ? `tone-${tone}` : ""}>{value == null ? "—" : signed(value)}</strong>
      <small>{note}</small>
    </div>
  );
}

function Versus({ label, v: [a, b] }: { label: string; v: [number, number] }) {
  const tot = a + b;
  return (
    <div className="grecap-tile grecap-vs">
      <small>{label}</small>
      <p><strong className="grecap-vs__ally">{a}</strong><span>–</span><strong className="tone-bad">{b}</strong></p>
      <div className="grecap-vs__bar" aria-hidden="true">
        <span style={{ flexGrow: tot ? a : 1, opacity: a || !tot ? 1 : 0.25 }} />
        <span style={{ flexGrow: tot ? b : 1, opacity: b || !tot ? 1 : 0.25 }} />
      </div>
    </div>
  );
}

function Points({ title, tone, points, fill }: { title: string; tone: "good" | "bad"; points: Point[]; fill: (s: string) => string }) {
  return (
    <div className="grecap-points">
      <p className={`grecap-points__title tone-${tone}`}><span className="dot-mark" />{title}</p>
      {points.length
        ? points.map((p) => (
          <div key={p.title} className={`grecap-point grecap-point--${tone}`}><strong>{p.title}</strong><small>{fill(p.detail)}</small></div>
        ))
        : <p className="muted small">{t("Rien de marquant sur cette partie.")}</p>}
    </div>
  );
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
