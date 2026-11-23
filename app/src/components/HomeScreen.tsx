// Accueil de l'onglet Draft hors draft (maquette « draft waiting », proposition A) : ta prochaine draft en grand
// (tes 3 picks du rôle, leurs bons et mauvais matchups), puis ta dernière partie et ta semaine.
// Sans client LoL, les picks restent (stats Master+ et perso) et une seule carte remplace le reste.
import { Chip, TopBar } from "./TopBar";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PersonalState } from "../lib/api";
import { loadHistory, type Game } from "../lib/history";
import { t } from "../lib/i18n";
import { loadRecap } from "../lib/recap";
import { blindSafe, laneExtremes, ROLE_LABELS, tierList, type Stats } from "../lib/score";
import { champName, dec1, pct } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { WeekGoals } from "./Goals";
import { Segmented } from "./Segmented";

interface Props {
  stats: Stats;
  clientOn: boolean;
  clientText: string;
  /** région du compte connecté (pastille de la barre de contexte) */
  region?: string | null;
  me: string | null;
  pools: number[][];
  mainRole: number | null;
  /** Change à chaque partie suivie (LP enregistrés) : recharge la dernière partie et la semaine. */
  version: number;
  onRecap: (g: Game) => void;
  onHistory: () => void;
  onPool: () => void;
  onTierList: (role: number) => void;
  onDemo: () => void;
  /** Stats perso : ton winrate sur les champions de ton pool. */
  perso?: PersonalState;
  /** Bandeau « Partie trouvée », affiché en haut de l'écran d'attente. */
  ready?: ReactNode;
}

const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 60) return t("il y a {n} min", { n: Math.max(1, min) });
  const h = Math.round(min / 60);
  if (h < 24) return t("il y a {n} h", { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t("hier") : t("il y a {n} j", { n: d });
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const signed = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : "0");

export function HomeScreen({ stats, clientOn, clientText, region, me, pools, mainRole, version, onRecap, onHistory, onPool, onTierList, onDemo, perso, ready }: Props) {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    if (!clientOn) { setGames(null); return; }
    let alive = true;
    loadHistory(50).then((g) => alive && setGames(g)).catch(() => alive && setGames([]));
    return () => { alive = false; };
  }, [clientOn, version]);

  const last = games?.find((g) => !g.remake) ?? null;
  const [opp, setOpp] = useState<string | null>(null);
  useEffect(() => {
    setOpp(null);
    if (!last || !me) return;
    let alive = true;
    loadRecap(last.id, me).then((r) => {
      if (!alive || !r) return;
      setOpp(r.oppChamp != null ? champName(stats, r.oppChamp) : null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [last?.id, me, stats]); // eslint-disable-line react-hooks/exhaustive-deps

  // rôle affiché : ton rôle principal, sinon le premier rôle où tu as un pool ; le joueur peut en changer
  const defaultRole = mainRole ?? Math.max(0, pools.findIndex((p) => p.length > 0));
  const [picked, setPicked] = useState<number | null>(null);
  const role = picked ?? defaultRole;
  const tiers = useMemo(() => tierList(stats, role), [stats, role]);
  const tierOf = useMemo(() => new Map(tiers.map((r) => [r.champ, r])), [tiers]);
  const pool = pools[role] ?? [];
  const best = useMemo(() => [...tiers].sort((a, b) => b.score - a.score).filter((r) => !pool.includes(r.champ)).slice(0, 3), [tiers, pool]);

  const week = (games ?? []).filter((g) => !g.remake && Date.now() - g.created < 7 * 86_400_000);
  const weekWins = week.filter((g) => g.win).length;
  const tracked = week.filter((g) => g.lp != null);
  const weekLp = tracked.reduce((a, g) => a + (g.lp ?? 0), 0);
  // courbe des LP de la semaine, de la plus ancienne partie à la plus récente
  const lpCurve = useMemo(() => {
    const pts = [0];
    for (const g of [...tracked].sort((a, b) => a.created - b.created)) pts.push(pts[pts.length - 1] + (g.lp ?? 0));
    return pts;
  }, [tracked.map((g) => g.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ton pool classé par ton winrate perso (sinon celui du Master+) ; sans pool, les meilleurs du rôle
  const mine = perso?.kind === "ready" ? perso.data : null;
  const picks = useMemo(() => (pool.length ? pool : best.map((r) => r.champ)).map((champ) => {
    const r = tierOf.get(champ), me2 = mine?.byRole.get(`${champ}:${role}`);
    const wr = me2 && me2[0] > 0 ? me2[1] / me2[0] : null;
    return { champ, tier: r?.tier ?? null, order: wr ?? (r ? r.winrate - 1 : -2),
             sub: me2 && wr != null ? (me2[0] > 1 ? t("{wr} sur {n} parties", { wr: pct(wr), n: me2[0] }) : t("{wr} sur 1 partie", { wr: pct(wr) })) : r ? t("{wr} en Master+", { wr: pct(r.winrate) }) : "—",
             safe: blindSafe(stats, champ, role), ...laneExtremes(stats, champ, role, 2) };
  }).sort((a, b) => b.order - a.order).slice(0, 3), [pool, best, tierOf, mine, role, stats]);

  return (
    <div className="content home">
      <TopBar title={t("Draft")}>
        <Chip tone={clientOn ? "good" : undefined} dot>{clientOn ? `${t("Client connecté")}${region ? ` · ${region}` : ""}` : clientText}</Chip>
      </TopBar>

      {ready}
      <section className="pf-card next-draft" aria-label={t("Ta prochaine draft")}>
        <div className="next-draft__head">
          <h2>{t("Ta prochaine draft")}</h2>
          <Segmented className="segmented next-draft__roles" role="tablist" aria-label={t("Rôle")}>
            {ROLE_LABELS.map((label, i) => (
              <button key={i} role="tab" aria-selected={i === role} className={i === role ? "is-active" : ""} onClick={() => setPicked(i)}>{label}</button>
            ))}
          </Segmented>
        </div>
        {picks.length === 0 ? <p className="home-empty">{t("Pas encore assez de parties pour ce rôle.")}</p> : (
          <div className="next-draft__picks">
            {picks.map((x, i) => (
              <article key={x.champ} className={`next-pick${i === 0 ? " is-best" : ""}`}>
                <div className="next-pick__top">
                  <ChampionIcon stats={stats} champ={x.champ} size={4} />
                  <div className="next-pick__name"><strong>{champName(stats, x.champ)}</strong><small>{x.sub}</small></div>
                  {i === 0 && <Chip tone="accent">{t("Meilleur choix")}</Chip>}
                </div>
                <div className="next-pick__tags">
                  {x.tier && <span className={`tl2-group__tier tier--${x.tier}`}>{t("Tier {tier}", { tier: x.tier })}</span>}
                  {x.safe === true ? <Chip tone="good">{t("Sûr en blind")}</Chip> : x.safe === false ? <Chip>{t("Mieux en counter")}</Chip> : null}
                </div>
                <MatchupRow stats={stats} label={t("Fort contre")} champs={x.good} />
                <MatchupRow stats={stats} label={t("À éviter contre")} champs={x.bad} />
              </article>
            ))}
          </div>
        )}
        <div className="next-draft__actions">
          {clientOn && <button className="btn btn--secondary btn--small" onClick={onDemo}>{t("Simuler une draft")}</button>}
          <button className="link-btn" onClick={pool.length ? onPool : () => onTierList(role)}>{pool.length ? t("Modifier ton pool") : t("Tier list")}</button>
          {pool.length === 0 && <button className="link-btn" onClick={onPool}>{t("Ajouter des champions à ton pool")}</button>}
        </div>
      </section>

      {!clientOn ? (
        <section className="pf-card home-off">
          <span className="home-off__dot" aria-hidden />
          <div className="home-off__text"><strong>{t("Client LoL fermé")}</strong><small>{t("Ta dernière partie, ta semaine et la draft en direct reviennent dès qu’il est ouvert.")}</small></div>
          <button className="btn btn--primary btn--small" onClick={onDemo}>{t("Simuler une draft")}</button>
        </section>
      ) : (
        <div className="home-row">
          <section className="pf-card home3__card">
            <div className="pf-card__head"><h2>{t("Ta dernière partie")}</h2>{last && <small className="muted">{ago(last.created)}</small>}</div>
            {games == null ? (
              <div className="skeleton"><span /><span /></div>
            ) : !last ? (
              <p className="home-empty">{t("Pas encore de partie dans l’historique du client.")}</p>
            ) : (
              <>
                <div className="home-lastrow">
                  <ChampionIcon stats={stats} champ={last.champ} size={2.75} />
                  <div className="home-lastrow__text">
                    <strong className={last.win ? "tone-good" : "tone-bad"}>{last.win ? t("Victoire") : t("Défaite")}</strong>
                    <small>{[champName(stats, last.champ), last.role != null ? ROLE_LABELS[last.role] : null, clock(last.duration), opp ? t("contre {opp}", { opp }) : null].filter(Boolean).join(" · ")}</small>
                  </div>
                  <span className="grow" />
                  <div className="home-stat"><strong>{last.kills} / {last.deaths} / {last.assists}</strong><span>KDA</span></div>
                  <div className="home-stat"><strong>{dec1(last.cs / Math.max(1, last.duration / 60))}</strong><span>{t("CS/min")}</span></div>
                  <div className="home-stat"><strong className={last.lp == null ? "" : last.lp >= 0 ? "tone-good" : "tone-bad"}>{last.lp == null ? "—" : signed(last.lp)}</strong><span>{t("LP")}</span></div>
                </div>
                <div className="home3__actions">
                  {me && <button className="btn btn--secondary home3__btn" onClick={() => onRecap(last)}>{t("Voir le récap")}</button>}
                  <button className="link-btn" onClick={onHistory}>{t("Historique")}</button>
                </div>
              </>
            )}
          </section>

          <section className="pf-card home3__card">
            <div className="pf-card__head"><h2>{t("Ta semaine")}</h2></div>
            {games == null ? <div className="skeleton"><span /><span /></div> : (
              <>
                {week.length > 0 && (
                  <div className="home-weekrow">
                    <div className="home-stat"><strong className={tracked.length ? `tone-${weekLp >= 0 ? "good" : "bad"}` : ""}>{tracked.length ? signed(weekLp) : "—"}</strong><span>{t("LP")}</span></div>
                    {lpCurve.length > 2 && <Spark points={lpCurve} tone={weekLp >= 0 ? "good" : "bad"} />}
                    <span className="grow" />
                    <div className="home-stat home-stat--end"><strong>{pct(weekWins / week.length)}</strong><span>{t("{w} V · {l} D", { w: weekWins, l: week.length - weekWins })}</span></div>
                  </div>
                )}
                <WeekGoals stats={stats} games={games} defaultChamp={pool[0] ?? null} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function MatchupRow({ stats, label, champs }: { stats: Stats; label: string; champs: number[] }) {
  return (
    <div className="next-pick__vs">
      <span>{label}</span>
      <span className="grow" />
      {champs.length ? champs.map((c) => <span key={c} title={champName(stats, c)}><ChampionIcon stats={stats} champ={c} size={1.5} /></span>)
        : <span className="muted">—</span>}
    </div>
  );
}

/** Petite courbe (LP de la semaine). */
function Spark({ points, tone }: { points: number[]; tone: "good" | "bad" }) {
  const w = 140, h = 36, min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((p, i) => [i * (w / (points.length - 1)), 2 + (h - 4) - ((p - min) / span) * (h - 4)]);
  const zero = 2 + (h - 4) - ((0 - min) / span) * (h - 4);
  return (
    <svg className={`home-spark tone-${tone}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <line x1="0" x2={w} y1={zero} y2={zero} className="home-spark__zero" />
      <polyline points={xy.map((q) => q.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
