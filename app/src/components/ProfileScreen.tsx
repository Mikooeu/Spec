import { useState } from "react";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, int, pct } from "../lib/ui";
import type { PersonalState, Personal } from "../lib/api";
import type { Account } from "../lib/lcu";
import { ChampionIcon } from "./ChampionIcon";

export type { Pools } from "./PoolScreen";

interface Props {
  stats: Stats;
  account: Account | null;
  clientOn: boolean;
  perso: PersonalState;
  onRegister: (code: string) => Promise<string | null>;
}

/** Profil : compte détecté, activation des stats perso, résumé de la saison. */
export function ProfileScreen({ stats, account, clientOn, perso, onRegister }: Props) {
  const [code, setCode] = useState("");
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

      {perso.kind === "ready" && <SeasonTiles stats={stats} data={perso.data} />}

      <section className="history-soon card">
        <h2>Historique</h2>
        <p className="muted small">Bientôt : tes dernières parties avec filtres par file et par poste, et les LP gagnés ou perdus.</p>
      </section>
    </div>
  );
}

/** Winrate de la saison, champion le plus joué, rôle principal. */
function SeasonTiles({ stats, data }: { stats: Stats; data: Personal }) {
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
      <div className="tile-stat">
        <span className="tile-stat__label">Rôle principal</span>
        <span className="tile-stat__value">{ROLE_LABELS[mainRole]}</span>
        <span className="tile-stat__detail">{pct(byRole[mainRole] / games)} de tes parties</span>
      </div>
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
