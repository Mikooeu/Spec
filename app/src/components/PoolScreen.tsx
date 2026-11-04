import { useMemo, useState } from "react";
import { ROLE_LABELS, gamesIn, type Stats } from "../lib/score";
import { champName, normalize, pct, wrTone } from "../lib/ui";
import { PREFILL_MIN_GAMES, topChampions, type PersonalState } from "../lib/api";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";

export type Pools = number[][]; // un pool par rôle (index dans ROLES)

interface Props {
  stats: Stats;
  pools: Pools;
  onChange: (p: Pools) => void;
  perso: PersonalState;
}

const WR_MIN_GAMES = 100;   // en dessous, le winrate du rôle n'est pas affiché (trop peu de parties)

/** Champion pool : les champions joués dans chaque rôle, recommandés en priorité pendant la draft. */
export function PoolScreen({ stats, pools, onChange, perso }: Props) {
  const [role, setRole] = useState(2);
  const [query, setQuery] = useState("");
  const ready = perso.kind === "ready" ? perso.data : null;
  const suggested = ready ? topChampions(ready, role) : [];
  const missing = suggested.filter((c) => !pools[role].includes(c));
  const pool = pools[role];

  const prefill = () => {
    const next = pools.map((p) => [...p]);
    next[role] = [...pools[role], ...missing];
    onChange(next);
  };

  const list = useMemo(() => {
    const q = normalize(query);
    return [...stats.champions.values()]
      .filter((c) => !q || normalize(c.name).includes(q))
      // les champions les plus joués dans ce rôle en Master+ d'abord
      .sort((a, b) => gamesIn(stats, b.id, role) - gamesIn(stats, a.id, role) || a.name.localeCompare(b.name, "fr"));
  }, [stats, query, role]);

  // winrate Master+ du champion dans le rôle choisi (Ambessa n'a pas le même en top et en jungle)
  const roleWr = (champ: number) => {
    const [g, w] = stats.base.get(`${champ}|${role}`) ?? [0, 0];
    return g >= WR_MIN_GAMES ? w / g : null;
  };

  const toggle = (champ: number) => {
    const next = pools.map((p) => [...p]);
    next[role] = pool.includes(champ) ? pool.filter((c) => c !== champ) : [...pool, champ];
    onChange(next);
  };

  return (
    <div className="content">
      <header className="page-head">
        <div>
          <p className="overline">Champion pool</p>
          <h1>Ton champion pool</h1>
        </div>
      </header>
      <p className="muted page-intro">Choisis les champions que tu joues dans chaque rôle : Spec te les recommande en priorité pendant la draft. Le pourcentage est leur winrate Master+ dans le rôle choisi.</p>

      <section className="pool">
        <Segmented className="segmented" role="tablist" aria-label="Rôle">
          {ROLE_LABELS.map((label, i) => (
            <button key={label} role="tab" aria-selected={role === i} className={role === i ? "is-active" : ""}
                    onClick={() => setRole(i)}>
              {label} <span className="count">{pools[i].length}</span>
            </button>
          ))}
        </Segmented>

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
              {roleWr(c) != null && <span className={`chip__wr tone-${wrTone(roleWr(c)!)}`}>{pct(roleWr(c)!)}</span>}
              <span className="chip__x" aria-hidden>×</span>
            </button>
          ))}
        </div>

        <div className="search-wrap">
          <input className="search" placeholder="Rechercher un champion" value={query}
                 onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          {query && (
            <button className="search__clear" onClick={() => setQuery("")} aria-label="Effacer la recherche" title="Effacer">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.25" />
                <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="grid">
          {list.map((c) => {
            const wr = roleWr(c.id);
            return (
              <button key={c.id} className={`tile${pool.includes(c.id) ? " is-selected" : ""}`}
                      aria-pressed={pool.includes(c.id)} onClick={() => toggle(c.id)}
                      title={wr == null ? `Pas assez de parties ${ROLE_LABELS[role]}` : `${pct(wr)} de winrate en ${ROLE_LABELS[role]} (Master+)`}>
                <ChampionIcon stats={stats} champ={c.id} size={3} />
                <span>{c.name}</span>
                <span className={`tile__wr tone-${wr == null ? "neutral" : wrTone(wr)}`}>{wr == null ? "—" : pct(wr)}</span>
              </button>
            );
          })}
          {list.length === 0 && <p className="muted small">Aucun champion ne correspond à « {query} ».</p>}
        </div>
      </section>
    </div>
  );
}

function prefillText(perso: PersonalState, found: number, missing: number, role: string): string {
  if (perso.kind !== "ready") return `Avec tes stats perso (à activer dans Profil), ajoute tes champions joués ${PREFILL_MIN_GAMES} fois ou plus en ${role} cette saison.`;
  if (found === 0) return perso.data.syncing
    ? `Synchro en cours : tes champions ${role} apparaîtront ici.`
    : `Aucun champion avec ${PREFILL_MIN_GAMES} parties ou plus en ${role} cette saison.`;
  if (missing === 0) return `Tes champions les plus joués en ${role} sont déjà dans ton pool.`;
  return `Ajoute tes ${missing} champion${missing > 1 ? "s" : ""} avec ${PREFILL_MIN_GAMES} parties ou plus en ${role} cette saison.`;
}
