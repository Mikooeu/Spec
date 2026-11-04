import { useMemo, useState, type ReactNode } from "react";
import { ROLE_LABELS, TIER_MIN_PICKRATE, tierList, type Stats, type TierRow } from "../lib/score";
import { champName, int, patchLabel, pct, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";

type SortKey = "score" | "winrate" | "pickrate" | "banrate";
const SORTS: [SortKey, string][] = [["score", "Score"], ["winrate", "Winrate"], ["pickrate", "Pickrate"], ["banrate", "Banrate"]];

/** Tier list solo/duo Master+ par rôle, triable par winrate, pickrate ou banrate. */
export function TierListScreen({ stats, role, onRole, onOpen, region, regionLabel = "EUW" }:
  { stats: Stats; role: number; onRole: (role: number) => void; onOpen: (champ: number, role: number) => void;
    region?: ReactNode; regionLabel?: string }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [asc, setAsc] = useState(false); // décroissant par défaut
  // même colonne : on inverse l'ordre ; autre colonne : on repart en décroissant
  const choose = (key: SortKey) => {
    if (key === sort) setAsc(!asc);
    else { setSort(key); setAsc(false); }
  };
  const arrow = asc ? "↑" : "↓";
  const lists = useMemo(() => [0, 1, 2, 3, 4].map((r) => tierList(stats, r)), [stats]);
  const hasBans = stats.banMatches > 0;
  const rows = useMemo(() => {
    const value = (r: TierRow) => (sort === "banrate" ? r.banrate ?? -1 : r[sort]);
    return [...lists[role]].sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a)));
  }, [lists, role, sort, asc]);

  return (
    <div className="content">
      <header className="page-head">
        <div>
          <p className="overline">Tier list · solo/duo Master+ {regionLabel} · patch {patchLabel(stats.meta.patch)}</p>
          <h1>Tier list</h1>
        </div>
        {region && <div className="head-actions">{region}</div>}
      </header>

      <div className="tier-controls">
        <Segmented className="segmented" role="tablist" aria-label="Rôle">
          {ROLE_LABELS.map((label, i) => (
            <button key={label} role="tab" aria-selected={role === i} className={role === i ? "is-active" : ""}
                    onClick={() => onRole(i)}>
              {label} <span className="count">{lists[i].length}</span>
            </button>
          ))}
        </Segmented>
        <div className="tier-sort">
          <span className="muted small">Trier par</span>
          <Segmented className="segmented" role="tablist" aria-label="Tri">
            {SORTS.map(([key, label]) => (
              <button key={key} role="tab" aria-selected={sort === key} className={sort === key ? "is-active" : ""}
                      onClick={() => choose(key)}
                      title={sort === key ? (asc ? "Trier du plus haut au plus bas" : "Trier du plus bas au plus haut") : undefined}>
                {label}{sort === key && <span className="count">{arrow}</span>}
              </button>
            ))}
          </Segmented>
        </div>
      </div>
      <p className="muted small">
        Champions joués dans plus de {Math.round(TIER_MIN_PICKRATE * 100)} % des parties {ROLE_LABELS[role]} ·{" "}
        {int(Number(stats.meta.matches ?? 0))} parties analysées
        {!hasBans && " · banrate en cours de collecte"}
        {" · "}Score : winrate corrigé selon le nombre de parties, plus un petit bonus de pick rate et de ban rate
      </p>

      <div className="tier-table" role="table" aria-label={`Tier list ${ROLE_LABELS[role]}`}>
        <div className="tier-row tier-row--head" role="row">
          <span className="tier-row__rank" role="columnheader">#</span>
          <span className="tier-row__tier" role="columnheader">Tier</span>
          <span className="tier-row__champ" role="columnheader">Champion</span>
          {SORTS.map(([key, label]) => (
            <button key={key} role="columnheader" className={`tier-row__num${sort === key ? " is-sorted" : ""}`}
                    onClick={() => choose(key)} aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}>
              {label}{sort === key ? ` ${arrow}` : ""}
            </button>
          ))}
        </div>
        <div className="stagger tier-table__rows" key={`${role}-${sort}-${asc}`}>
        {rows.map((r, i) => (
          <button key={r.champ} className="tier-row tier-row--link" role="row" onClick={() => onOpen(r.champ, role)}
                  title={`Ouvrir la page de ${champName(stats, r.champ)}`}>
            <span className="tier-row__rank">{i + 1}</span>
            <span className={`tier-row__tier tier--${r.tier}`}>{r.tier}</span>
            <span className="tier-row__champ">
              <ChampionIcon stats={stats} champ={r.champ} size={1.75} />
              <span className="tier-row__name">{champName(stats, r.champ)}</span>
            </span>
            <span className="tier-row__num tier-row__score">{(r.score * 100).toFixed(1).replace(".", ",")}</span>
            <span className={`tier-row__num tier-row__wr tone-${wrTone(r.winrate)}`}>{pct(r.winrate)}</span>
            <span className="tier-row__num">{pct(r.pickrate)}</span>
            <span className="tier-row__num">{r.banrate == null ? "—" : pct(r.banrate)}</span>
          </button>
        ))}
        </div>
        {rows.length === 0 && (
          <p className="hint">Pas encore assez de parties en {ROLE_LABELS[role]}. Laisse tourner le collecteur.</p>
        )}
      </div>
    </div>
  );
}
