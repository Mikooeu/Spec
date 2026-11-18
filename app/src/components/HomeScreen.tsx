// Accueil de l'onglet Draft hors draft : ta dernière partie, ton pool, les meilleurs picks du patch et ta semaine.
// Remplace l'ancien écran « En attente de la draft » (un chargement qui tournait sans fin).
import { Chip, TopBar } from "./TopBar";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PersonalState } from "../lib/api";
import { loadHistory, type Game } from "../lib/history";
import { t } from "../lib/i18n";
import { loadRecap } from "../lib/recap";
import { ROLE_LABELS, tierList, type Stats } from "../lib/score";
import { champName, dec1, pct } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { WeekGoals } from "./Goals";

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

  // rôle affiché : ton rôle principal, sinon le premier rôle où tu as un pool
  const role = mainRole ?? Math.max(0, pools.findIndex((p) => p.length > 0));
  const tiers = useMemo(() => tierList(stats, role), [stats, role]);
  const tierOf = useMemo(() => new Map(tiers.map((r) => [r.champ, r])), [tiers]);
  const pool = pools[role] ?? [];
  const best = useMemo(() => [...tiers].sort((a, b) => b.score - a.score).filter((r) => !pool.includes(r.champ)).slice(0, 3), [tiers, pool]);

  const week = (games ?? []).filter((g) => !g.remake && Date.now() - g.created < 7 * 86_400_000);
  const weekWins = week.filter((g) => g.win).length;
  const tracked = week.filter((g) => g.lp != null);
  const weekLp = tracked.reduce((a, g) => a + (g.lp ?? 0), 0);

  // ton pool classé par ton winrate perso (sinon celui du Master+) ; sans pool, les meilleurs du rôle
  const mine = perso?.kind === "ready" ? perso.data : null;
  const picks = (pool.length ? pool : best.map((r) => r.champ)).map((champ) => {
    const r = tierOf.get(champ), me2 = mine?.byRole.get(`${champ}:${role}`);
    const wr = me2 && me2[0] > 0 ? me2[1] / me2[0] : null;
    return { champ, tier: r?.tier ?? null, order: wr ?? (r ? r.winrate - 1 : -2),
             sub: me2 && wr != null ? (me2[0] > 1 ? t("{wr} sur {n} parties", { wr: pct(wr), n: me2[0] }) : t("{wr} sur 1 partie", { wr: pct(wr) })) : r ? t("{wr} en Master+", { wr: pct(r.winrate) }) : "—" };
  }).sort((a, b) => b.order - a.order).slice(0, 4);
  return (
    <div className="content home">
      <TopBar title={t("Draft")}>
        <Chip tone={clientOn ? "good" : undefined} dot>{clientOn ? `${t("Client connecté")}${region ? ` · ${region}` : ""}` : clientText}</Chip>
      </TopBar>

      {ready}
      <div className="home3">
        <section className="pf-card home3__card">
          <div className="pf-card__head"><h2>{t("Objectifs de la semaine")}</h2></div>
          {!clientOn || games == null ? <p className="home-empty">{t("Disponible avec le client LoL ouvert.")}</p> : (
            <>
              {week.length > 0 && (
                <div className="pf-summary home3-stats">
                  <div><strong className={tracked.length ? `tone-${weekLp >= 0 ? "good" : "bad"}` : ""}>{tracked.length ? signed(weekLp) : "—"}</strong><span>{t("LP")}</span></div>
                  <div><strong>{pct(weekWins / week.length)}</strong><span>{t("Winrate")}</span></div>
                  <div><strong>{week.length}</strong><span>{t("Parties")}</span></div>
                </div>
              )}
              <WeekGoals stats={stats} games={games} defaultChamp={pool[0] ?? null} />
            </>
          )}
        </section>

        <section className="pf-card home3__card">
          <div className="pf-card__head"><h2>{t("Ta dernière partie")}</h2>{last && <small className="muted">{ago(last.created)}</small>}</div>
          {!clientOn ? (
            <div className="home-empty">
              <p>{t("Ouvre le client LoL pour retrouver ta dernière partie et ta semaine.")}</p>
              <button className="btn btn--secondary btn--small" onClick={onDemo}>{t("Simuler une draft")}</button>
            </div>
          ) : games == null ? (
            <div className="skeleton"><span /><span /></div>
          ) : !last ? (
            <p className="home-empty">{t("Pas encore de partie dans l’historique du client.")}</p>
          ) : (
            <>
              <div className="home3-last">
                <ChampionIcon stats={stats} champ={last.champ} size={3} />
                <div>
                  <strong className={last.win ? "tone-good" : "tone-bad"}>{last.win ? t("Victoire") : t("Défaite")}</strong>
                  <small>{[champName(stats, last.champ), last.role != null ? ROLE_LABELS[last.role] : null, clock(last.duration), opp ? t("contre {opp}", { opp }) : null].filter(Boolean).join(" · ")}</small>
                </div>
              </div>
              <div className="pf-summary home3-stats">
                <div><strong>{last.kills} / {last.deaths} / {last.assists}</strong><span>KDA</span></div>
                <div><strong>{dec1(last.cs / Math.max(1, last.duration / 60))}</strong><span>{t("CS/min")}</span></div>
                <div><strong className={last.lp == null ? "" : last.lp >= 0 ? "tone-good" : "tone-bad"}>{last.lp == null ? "—" : signed(last.lp)}</strong><span>{t("LP")}</span></div>
              </div>
              <div className="home3__actions">
                {me && <button className="btn btn--secondary home3__btn" onClick={() => onRecap(last)}>{t("Voir le récap")}</button>}
                <button className="link-btn" onClick={onHistory}>{t("Historique")}</button>
              </div>
            </>
          )}
        </section>

        <section className="pf-card home3__card">
          <div className="pf-card__head"><h2>{pool.length ? t("Tes meilleurs picks en {v}", { v: ROLE_LABELS[role] }) : t("Les plus forts en {v} ce patch", { v: ROLE_LABELS[role] })}</h2>
            <button className="link-btn" onClick={pool.length ? onPool : () => onTierList(role)}>{pool.length ? t("Modifier") : t("Tier list")}</button></div>
          {picks.length === 0 ? <p className="home-empty">{t("Pas encore assez de parties pour ce rôle.")}</p> : picks.map((x) => (
            <div key={x.champ} className="home3-pick">
              <ChampionIcon stats={stats} champ={x.champ} size={2.25} />
              <span><strong>{champName(stats, x.champ)}</strong><small>{x.sub}</small></span>
              <span className="grow" />
              {x.tier && <span className={`tl2-group__tier tier--${x.tier}`}>{t("Tier {tier}", { tier: x.tier })}</span>}
            </div>
          ))}
          {pool.length === 0 && <button className="link-btn home3__add" onClick={onPool}>{t("Ajouter des champions à ton pool")}</button>}
        </section>
      </div>
    </div>
  );
}
