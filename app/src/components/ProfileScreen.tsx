import { useMemo, useState } from "react";
import { ROLE_LABELS, gamesIn, type Stats } from "../lib/score";
import { champName, int, normalize } from "../lib/ui";
import { PREFILL_MIN_GAMES, topChampions, type PersonalState } from "../lib/api";
import type { Account } from "../lib/lcu";
import { ChampionIcon } from "./ChampionIcon";

export type Pools = number[][]; // un pool par rôle (index dans ROLES)

interface Props {
  stats: Stats;
  pools: Pools;
  onChange: (p: Pools) => void;
  account: Account | null;
  clientOn: boolean;
  perso: PersonalState;
  onRegister: (code: string) => Promise<string | null>;
}

export function ProfileScreen({ stats, pools, onChange, account, clientOn, perso, onRegister }: Props) {
  const [role, setRole] = useState(2);
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ready = perso.kind === "ready" ? perso.data : null;
  const suggested = ready ? topChampions(ready, role) : [];
  const missing = suggested.filter((c) => !pools[role].includes(c));

  const activate = async () => {
    setBusy(true);
    setMessage(await onRegister(code));
    setBusy(false);
  };

  const prefill = () => {
    const next = pools.map((p) => [...p]);
    next[role] = [...pools[role], ...missing];
    onChange(next);
  };
  const pool = pools[role];

  const list = useMemo(() => {
    const q = normalize(query);
    return [...stats.champions.values()]
      .filter((c) => !q || normalize(c.name).includes(q))
      // les champions les plus joués dans ce rôle en Master+ d'abord
      .sort((a, b) => gamesIn(stats, b.id, role) - gamesIn(stats, a.id, role) || a.name.localeCompare(b.name, "fr"));
  }, [stats, query, role]);

  const toggle = (champ: number) => {
    const next = pools.map((p) => [...p]);
    next[role] = pool.includes(champ) ? pool.filter((c) => c !== champ) : [...pool, champ];
    onChange(next);
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
            <p className="account__name">Active tes stats perso</p>
            <p className="muted small">Entre le code d’invitation reçu : Spec analysera tes parties classées de la saison.</p>
            {message && <p className="small tone-bad" role="alert">{message}</p>}
          </div>
          <input className="search search--code" placeholder="Code d’invitation" value={code} maxLength={9}
                 autoCapitalize="characters" spellCheck={false} aria-label="Code d’invitation"
                 onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn btn--primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? "Activation…" : "Activer"}
          </button>
        </form>
      )}

      <section className="pool">
        <div>
          <h2>Ton pool</h2>
          <p className="muted">Choisis les champions que tu joues dans chaque rôle.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Rôle">
          {ROLE_LABELS.map((label, i) => (
            <button key={label} role="tab" aria-selected={role === i} className={role === i ? "is-active" : ""}
                    onClick={() => setRole(i)}>
              {label} <span className="count">{pools[i].length}</span>
            </button>
          ))}
        </div>

        <div className="banner">
          <span className="grow">{prefillText(perso, ready ? suggested.length : 0, missing.length, ROLE_LABELS[role])}</span>
          <button className="btn btn--secondary" disabled={missing.length === 0} onClick={prefill}
                  title={missing.length ? `Ajouter ${missing.map((c) => champName(stats, c)).join(", ")}` : undefined}>
            Préremplir
          </button>
        </div>

        <p className="label">Dans ton pool {ROLE_LABELS[role]}</p>
        <div className="chips">
          {pool.length === 0 && <p className="muted small">Aucun champion pour l’instant : en autofill, Spec proposera les meilleurs choix du rôle.</p>}
          {pool.map((c) => (
            <button key={c} className="chip" onClick={() => toggle(c)} aria-label={`Retirer ${champName(stats, c)}`}>
              <ChampionIcon stats={stats} champ={c} size={1.75} />
              {champName(stats, c)}
              <span className="chip__x" aria-hidden>×</span>
            </button>
          ))}
        </div>

        <input className="search" placeholder="Rechercher un champion" value={query}
               onChange={(e) => setQuery(e.target.value)} />
        <div className="grid">
          {list.map((c) => (
            <button key={c.id} className={`tile${pool.includes(c.id) ? " is-selected" : ""}`}
                    aria-pressed={pool.includes(c.id)} onClick={() => toggle(c.id)}>
              <ChampionIcon stats={stats} champ={c.id} size={3} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </section>
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
      const base = `${int(d.matches)} partie${d.matches > 1 ? "s" : ""} classée${d.matches > 1 ? "s" : ""} analysée${d.matches > 1 ? "s" : ""} cette saison`;
      return d.syncing ? `${base} · synchro en cours, ${int(d.pending)} en attente` : base;
    }
  }
}

function prefillText(perso: PersonalState, found: number, missing: number, role: string): string {
  if (perso.kind !== "ready") return `Avec tes stats perso, ajoute tes champions joués ${PREFILL_MIN_GAMES} fois ou plus en ${role} cette saison.`;
  if (found === 0) return perso.data.syncing
    ? `Synchro en cours : tes champions ${role} apparaîtront ici.`
    : `Aucun champion avec ${PREFILL_MIN_GAMES} parties ou plus en ${role} cette saison.`;
  if (missing === 0) return `Tes champions les plus joués en ${role} sont déjà dans ton pool.`;
  return `Ajoute tes ${missing} champion${missing > 1 ? "s" : ""} avec ${PREFILL_MIN_GAMES} parties ou plus en ${role} cette saison.`;
}
