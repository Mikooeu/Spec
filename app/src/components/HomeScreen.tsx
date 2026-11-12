// Accueil de l'onglet Draft hors draft : ta dernière partie, ton pool, les meilleurs picks du patch et ta semaine.
// Remplace l'ancien écran « En attente de la draft » (un chargement qui tournait sans fin).
import { useEffect, useMemo, useState } from "react";
import { loadHistory, type Game } from "../lib/history";
import { t } from "../lib/i18n";
import { loadRecap } from "../lib/recap";
import { ROLE_LABELS, tierList, type Stats } from "../lib/score";
import { champName, patchLabel, pct } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { WeekGoals } from "./Goals";

interface Props {
  stats: Stats;
  clientOn: boolean;
  clientText: string;
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

export function HomeScreen({ stats, clientOn, clientText, me, pools, mainRole, version, onRecap, onHistory, onPool, onTierList, onDemo }: Props) {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    if (!clientOn) { setGames(null); return; }
    let alive = true;
    loadHistory(50).then((g) => alive && setGames(g)).catch(() => alive && setGames([]));
    return () => { alive = false; };
  }, [clientOn, version]);

  const last = games?.find((g) => !g.remake) ?? null;
  const [brief, setBrief] = useState<string | null>(null);
  useEffect(() => {
    setBrief(null);
    if (!last || !me) return;
    let alive = true;
    loadRecap(last.id, me).then((r) => {
      if (!alive || !r) return;
      const opp = r.oppChamp != null ? champName(stats, r.oppChamp) : t("ton vis-à-vis");
      setBrief(r.brief.replace("{opp}", opp));
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

  return (
    <div className="content home">
      <header className="page-head home__head">
        <div>
          <h1>{t("Prêt pour ta prochaine draft")}</h1>
        </div>
        <div className="home__status">
          <span className="home__pill"><span className={clientOn ? "dot" : "dot dot--off"} />{clientOn ? clientText : t("Client LoL fermé")}</span>
          <span className="home__pill"><span className="dot" />{t("Patch {v}", { v: patchLabel(stats.meta.patch) })}</span>
        </div>
      </header>

      <div className="home__grid">
        {/* dernière partie */}
        <section className="card home-card">
          <div className="home-card__head"><h2>{t("Dernière partie")}</h2>{last && <span className="muted small">{ago(last.created)}</span>}</div>
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
              <div className={`home-last home-last--${last.win ? "win" : "loss"}`}>
                <div className="home-last__top">
                  <ChampionIcon stats={stats} champ={last.champ} size={2.75} round />
                  <div className="home-last__title">
                    <p><strong className={last.win ? "tone-good" : "tone-bad"}>{last.win ? t("Victoire") : t("Défaite")}</strong>
                      <span>{champName(stats, last.champ)}{last.role != null ? ` · ${ROLE_LABELS[last.role]}` : ""}</span></p>
                    <small>{last.kills} / {last.deaths} / {last.assists} · {clock(last.duration)} · {last.queueName}</small>
                  </div>
                  {last.lp != null && <strong className={`home-last__lp tone-${last.lp >= 0 ? "good" : "bad"}`}>{signed(last.lp)} LP</strong>}
                </div>
                {brief && <p className="home-last__brief">{brief}</p>}
              </div>
              <div className="home-card__actions">
                {me && <button className="btn btn--primary btn--small" onClick={() => onRecap(last)}>{t("Voir le récap")}</button>}
                <button className="btn btn--secondary btn--small" onClick={onHistory}>{t("Historique")}</button>
              </div>
            </>
          )}
        </section>

        {/* ton pool */}
        <section className="card home-card home-card--side">
          <div className="home-card__head"><h2>{t("Ton pool {v}", { v: ROLE_LABELS[role] })}</h2>
            <button className="link-btn" onClick={onPool}>{pool.length ? t("Modifier") : t("Ajouter")}</button></div>
          {pool.length === 0 ? (
            <p className="home-empty">{t("Aucun champion pour l’instant : en draft, Spec proposera les meilleurs choix du rôle.")}</p>
          ) : (
            <ul className="home-list">
              {pool.slice(0, 5).map((c) => {
                const r = tierOf.get(c);
                return (
                  <li key={c}>
                    <ChampionIcon stats={stats} champ={c} size={2} round />
                    <span className="home-list__name">{champName(stats, c)}</span>
                    {r && <span className={`tier-chip tier--${r.tier}`}>{r.tier}</span>}
                    <span className={`home-list__wr${r && r.winrate < 0.49 ? " tone-bad" : ""}`}>{r ? pct(r.winrate) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* meilleurs picks du patch */}
        <section className="card home-card">
          <div className="home-card__head"><h2>{t("Les plus forts en {v} ce patch", { v: ROLE_LABELS[role] })}</h2>
            <button className="link-btn" onClick={() => onTierList(role)}>{t("Tier list")}</button></div>
          {best.length === 0 ? <p className="home-empty">{t("Pas encore assez de parties pour ce rôle.")}</p> : (
            <div className="home-best">
              {best.map((r) => (
                <div key={r.champ} className="home-best__tile">
                  <ChampionIcon stats={stats} champ={r.champ} size={2.25} round />
                  <div><strong>{champName(stats, r.champ)}</strong>
                    <small><span className={`tier-chip tier--${r.tier}`}>{r.tier}</span> {pct(r.winrate)}</small></div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ta semaine */}
        <section className="card home-card home-card--side">
          <div className="home-card__head"><h2>{t("Ta semaine")}</h2></div>
          {!clientOn || games == null ? <p className="home-empty">{t("Disponible avec le client LoL ouvert.")}</p>
            : week.length === 0 ? <p className="home-empty">{t("Aucune partie ces 7 derniers jours.")}</p> : (
            <div className="home-week">
              <div><small>{t("LP")}</small><strong className={tracked.length ? `tone-${weekLp >= 0 ? "good" : "bad"}` : ""}>{tracked.length ? signed(weekLp) : "—"}</strong></div>
              <div><small>{t("Winrate")}</small><strong>{pct(weekWins / week.length)}</strong></div>
              <div><small>{t("Parties")}</small><strong>{week.length}</strong></div>
            </div>
          )}
          {clientOn && games != null && <WeekGoals stats={stats} games={games} defaultChamp={pool[0] ?? null} />}
        </section>
      </div>
    </div>
  );
}
