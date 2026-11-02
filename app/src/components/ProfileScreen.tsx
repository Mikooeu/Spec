import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, int, pct } from "../lib/ui";
import type { PersonalState, Personal } from "../lib/api";
import type { Account } from "../lib/lcu";
import { ChampionIcon } from "./ChampionIcon";
import { QUEUE_LABELS, loadHistory, rankText, readRanked, type Game, type QueueKind } from "../lib/history";

export type { Pools } from "./PoolScreen";

interface Props {
  stats: Stats;
  account: Account | null;
  clientOn: boolean;
  perso: PersonalState;
  onRegister: (code: string) => Promise<string | null>;
  /** Change quand un nouvel écart de LP est enregistré : l'historique est relu. */
  lpVersion: number;
}

/** Profil : compte détecté, activation des stats perso, résumé de la saison. */
export function ProfileScreen({ stats, account, clientOn, perso, onRegister, lpVersion }: Props) {
  const [code, setCode] = useState("");
  const [games, setGames] = useState<Game[] | null>(null);
  const [rank, setRank] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    if (!clientOn) return;
    let alive = true;
    loadHistory(50).then((g) => { if (alive) { setGames(g); setHistoryError(false); } })
      .catch(() => alive && setHistoryError(true));
    readRanked().then((r) => alive && setRank(rankText(r?.queueMap?.RANKED_SOLO_5x5)));
    return () => { alive = false; };
  }, [clientOn, lpVersion]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const activate = async () => {
    setBusy(true);
    setMessage(await onRegister(code));
    setBusy(false);
  };

  return (
    <div className="content">
      <header className="page-head">
        <div>
          <p className="overline">Profil</p>
          <h1>Ton profil</h1>
        </div>
      </header>

      <div className="card account">
        <span className="icon icon--empty" style={{ width: "3rem", height: "3rem" }} aria-hidden />
        <div className="grow">
          <p className="account__name">{account ? `${account.name}${account.region ? ` · ${account.region}` : ""}` : "Aucun compte lié"}</p>
          {rank && <p className="account__rank">Classé Solo/Duo · {rank}</p>}
          <p className="muted small">{persoText(perso)}</p>
        </div>
        <span className="pill">
          <span className={clientOn ? "dot" : "dot dot--off"} />{clientOn ? "Client LoL connecté" : "Client LoL fermé"}
        </span>
      </div>

      {perso.kind === "unregistered" && (
        <form className="card activate" onSubmit={(e) => { e.preventDefault(); if (code.trim()) activate(); }}>
          <div className="grow">
            <p className="account__name">Stats perso</p>
            <p className="muted small">Entre le code d’activation reçu pour voir tes winrates personnels dans la draft.</p>
            {message && <p className="small tone-bad" role="alert">{message}</p>}
          </div>
          <input className="search search--code" placeholder="XXXX-XXXX" value={code} maxLength={9}
                 autoCapitalize="characters" spellCheck={false} aria-label="Code d’activation"
                 onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn btn--primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? "Activation…" : "Activer"}
          </button>
        </form>
      )}

      {perso.kind === "ready" && <SeasonTiles stats={stats} data={perso.data} games={games} />}

      <History stats={stats} games={games} clientOn={clientOn} error={historyError} />
    </div>
  );
}

/** Winrate de la saison, champion le plus joué, rôle principal. */
function SeasonTiles({ stats, data, games: history }: { stats: Stats; data: Personal; games: Game[] | null }) {
  let games = 0, wins = 0;
  for (const [g, w] of data.byChamp.values()) { games += g; wins += w; }
  const top = [...data.byChamp.entries()].sort((a, b) => b[1][0] - a[1][0])[0];
  const byRole = [0, 0, 0, 0, 0];
  for (const [, r, g] of data.champions) byRole[r] += g;
  const mainRole = byRole.indexOf(Math.max(...byRole));
  if (!games) return null;
  return (
    <div className="tiles">
      <div className="tile-stat">
        <span className="tile-stat__label">Winrate saison</span>
        <span className="tile-stat__value">{pct(wins / games)}</span>
        <span className="tile-stat__detail">{int(games)} parties classées</span>
      </div>
      <div className="tile-stat">
        <span className="tile-stat__label">Champion le plus joué</span>
        <span className="tile-stat__value tile-stat__value--champ">
          {top && <ChampionIcon stats={stats} champ={top[0]} size={1.75} />}
          {top ? champName(stats, top[0]) : "—"}
        </span>
        <span className="tile-stat__detail">{top ? `${pct(top[1][1] / top[1][0])} · ${int(top[1][0])} parties` : ""}</span>
      </div>
      {(() => {
        const week = (history ?? []).filter((g) => g.lp != null && Date.now() - g.created < 7 * 86400_000);
        if (!week.length) return (
          <div className="tile-stat">
            <span className="tile-stat__label">Rôle principal</span>
            <span className="tile-stat__value">{ROLE_LABELS[mainRole]}</span>
            <span className="tile-stat__detail">{pct(byRole[mainRole] / games)} de tes parties</span>
          </div>
        );
        const total = week.reduce((a, g) => a + (g.lp ?? 0), 0);
        return (
          <div className="tile-stat">
            <span className="tile-stat__label">LP cette semaine</span>
            <span className={`tile-stat__value tone-${total > 0 ? "good" : total < 0 ? "bad" : "neutral"}`}>{lpText(total)}</span>
            <span className="tile-stat__detail">{week.length} partie{week.length > 1 ? "s" : ""} suivie{week.length > 1 ? "s" : ""} par Spec</span>
          </div>
        );
      })()}
    </div>
  );
}

function persoText(perso: PersonalState): string {
  switch (perso.kind) {
    case "off": return "Stats perso indisponibles : serveur Spec non configuré.";
    case "no-account": return "Lance le client LoL : ton compte sera détecté automatiquement.";
    case "loading": return "Chargement de tes stats perso…";
    case "unregistered": return "Stats perso pas encore activées.";
    case "error": return "Serveur Spec injoignable pour l’instant.";
    case "ready": {
      const d = perso.data;
      const base = `Stats perso activées · ${int(d.matches)} partie${d.matches > 1 ? "s" : ""} classée${d.matches > 1 ? "s" : ""} analysée${d.matches > 1 ? "s" : ""} cette saison`;
      return d.syncing ? `${base} · synchro en cours, ${int(d.pending)} en attente` : base;
    }
  }
}

const lpText = (lp: number) => `${lp > 0 ? "+" : lp < 0 ? "−" : ""}${Math.abs(lp)} LP`;
const QUEUES: ("all" | QueueKind)[] = ["all", "solo", "flex", "5c5"];

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} j`;
}

/** Historique : filtre par file puis par poste ; résultat, KDA et LP de chaque partie. */
function History({ stats, games, clientOn, error }: { stats: Stats; games: Game[] | null; clientOn: boolean; error: boolean }) {
  const [queue, setQueue] = useState<"all" | QueueKind>("all");
  const [role, setRole] = useState<number | null>(null);
  const inQueue = useMemo(() => (games ?? []).filter((g) => queue === "all" ? g.queue !== "other" : g.queue === queue), [games, queue]);
  const shown = role == null ? inQueue : inQueue.filter((g) => g.role === role);
  const count = (q: "all" | QueueKind) => (games ?? []).filter((g) => q === "all" ? g.queue !== "other" : g.queue === q).length;

  return (
    <section className="history">
      <div>
        <h2>Historique</h2>
        <p className="muted small">Tes dernières parties classées. Les LP s’affichent pour les parties jouées avec Spec ouvert.</p>
      </div>
      {!clientOn && !games && <p className="hint">Lance le client LoL pour voir ton historique.</p>}
      {error && <p className="hint">Le client LoL n’a pas renvoyé ton historique. Réessaie dans un instant.</p>}
      {games && (
        <>
          <div className="history__filters">
            <div className="segmented" role="tablist" aria-label="File">
              {QUEUES.map((q) => (
                <button key={q} role="tab" aria-selected={queue === q} className={queue === q ? "is-active" : ""}
                        onClick={() => setQueue(q)}>
                  {q === "all" ? "Toutes" : QUEUE_LABELS[q]} <span className="count">{count(q)}</span>
                </button>
              ))}
            </div>
            <div className="segmented" role="tablist" aria-label="Poste">
              {[null, 0, 1, 2, 3, 4].map((r) => (
                <button key={String(r)} role="tab" aria-selected={role === r} className={role === r ? "is-active" : ""}
                        onClick={() => setRole(r)}>
                  {r == null ? "Tous" : ROLE_LABELS[r]}{" "}
                  <span className="count">{r == null ? inQueue.length : inQueue.filter((g) => g.role === r).length}</span>
                </button>
              ))}
            </div>
          </div>
          {shown.map((g) => <GameRow key={g.id} stats={stats} game={g} />)}
          {shown.length === 0 && <p className="hint">Aucune partie pour ce filtre.</p>}
        </>
      )}
    </section>
  );
}

function GameRow({ stats, game: g }: { stats: Stats; game: Game }) {
  const result = g.remake ? "remake" : g.win ? "win" : "loss";
  const kda = g.deaths ? (g.kills + g.assists) / g.deaths : g.kills + g.assists;
  const min = Math.round(g.duration / 60);
  return (
    <div className={`game game--${result}`}>
      <span className="game__bar" aria-hidden />
      <ChampionIcon stats={stats} champ={g.champ} size={2.5} />
      <span className="game__id">
        <span className="game__name">{champName(stats, g.champ)}</span>
        <span className="muted small">
          {g.queue === "other" ? g.queueName : QUEUE_LABELS[g.queue]}{g.role != null ? ` · ${ROLE_LABELS[g.role]}` : ""} · {ago(g.created)}
        </span>
      </span>
      <span className="grow" />
      <span className="stat-col">
        <span className="stat-col__value">{g.kills} / {g.deaths} / {g.assists}</span>
        <span className="stat-col__label">KDA {kda.toFixed(1).replace(".", ",")} · {int(g.cs)} CS</span>
      </span>
      <span className="game__sep" aria-hidden />
      <span className="stat-col game__lp">
        <span className={`game__lp-value${g.lp == null ? "" : g.lp > 0 ? " tone-good" : g.lp < 0 ? " tone-bad" : ""}`}>
          {g.lp == null ? "— LP" : lpText(g.lp)}
        </span>
        <span className="stat-col__label">{result === "remake" ? "Remake" : g.win ? "Victoire" : "Défaite"} · {min} min</span>
      </span>
    </div>
  );
}
