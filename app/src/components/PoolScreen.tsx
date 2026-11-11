import { useMemo, useRef, useState } from "react";
import { ROLE_LABELS, gamesIn, tierList, type Stats } from "../lib/score";
import { champName, normalize, pct } from "../lib/ui";
import { PREFILL_MIN_GAMES, topChampions, type PersonalState } from "../lib/api";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";
import { plural, t } from "../lib/i18n";

export type Pools = number[][]; // un pool par rôle (index dans ROLES)

interface Props {
  stats: Stats;
  pools: Pools;
  onChange: (p: Pools) => void;
  perso: PersonalState;
  /** Rôle affiché à l'ouverture (rôle principal choisi à l'accueil). */
  initialRole?: number;
}

const WR_MIN_GAMES = 100;   // en dessous, le winrate du rôle n'est pas affiché (trop peu de parties)

type Sort = "score" | "mine" | "az";

/** Champion pool : ton pool du rôle en haut, le catalogue complet en dessous (trié par score, tes parties ou A → Z). */
export function PoolScreen({ stats, pools, onChange, perso, initialRole = 2 }: Props) {
  const [role, setRole] = useState(initialRole);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const search = useRef<HTMLInputElement>(null);
  const ready = perso.kind === "ready" ? perso.data : null;
  const suggested = ready ? topChampions(ready, role) : [];
  const missing = suggested.filter((c) => !pools[role].includes(c));
  const pool = pools[role];

  const prefill = () => {
    const next = pools.map((p) => [...p]);
    next[role] = [...pools[role], ...missing];
    onChange(next);
  };
  const toggle = (champ: number) => {
    const next = pools.map((p) => [...p]);
    next[role] = pool.includes(champ) ? pool.filter((c) => c !== champ) : [...pool, champ];
    onChange(next);
  };

  // tier et winrate Master+ du champion dans ce rôle (Ambessa n'a pas le même en top et en jungle)
  const tiers = useMemo(() => new Map(tierList(stats, role).map((r) => [r.champ, r])), [stats, role]);
  const roleWr = (champ: number) => {
    const row = tiers.get(champ);
    if (row) return row.winrate;
    const [g, w] = stats.base.get(`${champ}|${role}`) ?? [0, 0];
    return g >= WR_MIN_GAMES ? w / g : null;
  };
  const mine = (champ: number) => ready?.byRole.get(`${champ}:${role}`) ?? null;   // [parties, victoires]
  const score = (champ: number) => tiers.get(champ)?.score ?? -1;

  const list = useMemo(() => {
    const q = normalize(query.trim());
    const all = [...stats.champions.values()].filter((c) => !q || normalize(c.name).includes(q));
    const byScore = (a: { id: number; name: string }, b: { id: number; name: string }) =>
      score(b.id) - score(a.id) || gamesIn(stats, b.id, role) - gamesIn(stats, a.id, role) || a.name.localeCompare(b.name);
    return all.sort(sort === "az" ? (a, b) => a.name.localeCompare(b.name)
      : sort === "mine" ? (a, b) => (mine(b.id)?.[0] ?? 0) - (mine(a.id)?.[0] ?? 0) || byScore(a, b)
      : byScore);
  }, [stats, query, role, sort, tiers, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const sub = (champ: number) => {
    const wr = roleWr(champ), m = mine(champ);
    const parts = [wr == null ? null : pct(wr), m && m[0] ? t("toi {wr} ({n})", { wr: `${Math.round((m[1] / m[0]) * 100)} %`, n: m[0] }) : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : t("Peu joué en {v}", { v: ROLE_LABELS[role] });
  };
  const sorted = [...pool].sort((a, b) => score(b) - score(a));

  return (
    <div className="content pool2">
      <header className="page-head">
        <div>
          <h1>{t("Ton champion pool")}</h1>
        </div>
      </header>

      <Segmented className="segmented pool2__roles" role="tablist" aria-label={t("Rôle")}>
        {ROLE_LABELS.map((label, i) => (
          <button key={label} role="tab" aria-selected={role === i} className={role === i ? "is-active" : ""} onClick={() => setRole(i)}>
            {label} <span className="count">{pools[i].length}</span>
          </button>
        ))}
      </Segmented>

      <section className="card pool2-card">
        <div className="pool2-card__head">
          <h2>{t("Dans ton pool {v}", { v: ROLE_LABELS[role] })}
            <small>{plural(pool.length, "{n} champion", "{n} champions")}</small></h2>
          {missing.length > 0
            ? <button className="link-btn pool2__prefill" onClick={prefill}
                      title={t("Ajouter {join}", { join: missing.map((c) => champName(stats, c)).join(", ") })}>
                {t("Ajouter mes {n} champions joués", { n: missing.length })}</button>
            : <span className="muted small pool2__hint">{prefillText(perso, ready ? suggested.length : 0, missing.length, ROLE_LABELS[role])}</span>}
        </div>
        <div className="pool2-mine">
          {sorted.map((c) => {
            const row = tiers.get(c);
            return (
              <div key={c} className="pool2-mine__card">
                <ChampionIcon stats={stats} champ={c} size={2.5} round />
                <div className="pool2-mine__text">
                  <p><strong>{champName(stats, c)}</strong>{row && <span className={`tier-chip tier--${row.tier}`}>{row.tier}</span>}</p>
                  <small>{sub(c)}</small>
                </div>
                <button className="pool2-mine__x" onClick={() => toggle(c)} aria-label={t("Retirer {champName}", { champName: champName(stats, c) })} title={t("Retirer")}>×</button>
              </div>
            );
          })}
          <button className="pool2-mine__add" onClick={() => search.current?.focus()}>{t("+ Ajouter")}</button>
        </div>
        {pool.length === 0 && <p className="muted small">{t("Aucun champion pour l’instant : en autofill, Spec proposera les meilleurs choix du rôle.")}</p>}
      </section>

      <section className="card pool2-card">
        <div className="pool2-card__head pool2-card__head--tools">
          <h2>{t("Ajouter des champions")}</h2>
          <Segmented className="segmented segmented--small" role="tablist" aria-label={t("Trier")}>
            {([["score", t("Score")], ["mine", t("Tes parties")], ["az", t("A → Z")]] as [Sort, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? "is-active" : ""}
                      disabled={k === "mine" && !ready} title={k === "mine" && !ready ? t("Active tes stats perso dans Profil") : undefined}
                      onClick={() => setSort(k)}>{label}</button>
            ))}
          </Segmented>
          <div className="search-wrap pool2__search">
            <input ref={search} className="search" placeholder={t("Rechercher un champion")} value={query}
                   onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          </div>
        </div>
        <div className="pool2-grid">
          {list.map((c) => {
            const on = pool.includes(c.id), row = tiers.get(c.id), m = mine(c.id);
            const wr = roleWr(c.id);
            return (
              <button key={c.id} className={`pool2-tile${on ? " is-selected" : ""}`} aria-pressed={on} onClick={() => toggle(c.id)}>
                <span className="pool2-tile__top">
                  <ChampionIcon stats={stats} champ={c.id} size={2.25} round />
                  <span className="pool2-tile__text">
                    <strong>{c.name}</strong>
                    <small>{wr == null ? "—" : pct(wr)}</small>
                  </span>
                  {row ? <span className={`tier-chip tier--${row.tier}`}>{row.tier}</span> : <span className="tier-chip tier--none">—</span>}
                </span>
                <span className="pool2-tile__foot">
                  {on ? t("✓ Dans ton pool") : t("+ Ajouter")}{m && m[0] ? ` · ${plural(m[0], "{n} partie", "{n} parties")}` : ""}
                </span>
              </button>
            );
          })}
          {list.length === 0 && <p className="muted small">{t("Aucun champion ne correspond à « ")}{query} ».</p>}
        </div>
      </section>
    </div>
  );
}

function prefillText(perso: PersonalState, found: number, missing: number, role: string): string {
  if (perso.kind !== "ready") return t("Avec tes stats perso (à activer dans Profil), ajoute tes champions joués {PREFILL_MIN_GAMES} fois ou plus en {role} cette saison.", { PREFILL_MIN_GAMES: PREFILL_MIN_GAMES, role: role });
  if (found === 0) return perso.data.syncing
    ? t("Synchro en cours : tes champions {role} apparaîtront ici.", { role: role })
    : t("Aucun champion avec {PREFILL_MIN_GAMES} parties ou plus en {role} cette saison.", { PREFILL_MIN_GAMES: PREFILL_MIN_GAMES, role: role });
  if (missing === 0) return t("Tes champions les plus joués en {role} sont déjà dans ton pool.", { role: role });
  return t("Ajoute tes {missing} champion{v} avec {PREFILL_MIN_GAMES} parties ou plus en {role} cette saison.", { missing: missing, v: missing > 1 ? "s" : "", PREFILL_MIN_GAMES: PREFILL_MIN_GAMES, role: role });
}
