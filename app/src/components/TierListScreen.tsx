import { EloBadge } from "./EloBadge";
import { useMemo, useState, type ReactNode } from "react";
import { ROLE_LABELS, tierList, type Stats, type TierRow } from "../lib/score";
import { champName, dec1, normalize, pct, wrTone } from "../lib/ui";
import { RoleIcon } from "./RoleIcon";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";
import { Trend } from "./Trend";
import { t } from "../lib/i18n";

type SortKey = "score" | "winrate" | "pickrate" | "banrate";
const SORTS: [SortKey, string][] = [["score", t("Score")], ["winrate", t("Winrate")], ["pickrate", t("Pickrate")], ["banrate", t("Banrate")]];

/** Tier list solo/duo Master+ par rôle. Un clic sur l'en-tête d'une colonne trie (re-clic : ordre inversé). */
export function TierListScreen({ stats, role, onRole, onOpen, region }:
  { stats: Stats; role: number; onRole: (role: number) => void; onOpen: (champ: number, role: number) => void;
    region?: ReactNode; regionLabel?: string }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [asc, setAsc] = useState(false); // décroissant par défaut
  const [all, setAll] = useState(false);  // onglet « Tous » : une ligne par champion et par rôle
  const [query, setQuery] = useState("");
  // même colonne : on inverse l'ordre ; autre colonne : on repart en décroissant
  const choose = (key: SortKey) => {
    if (key === sort) setAsc(!asc);
    else { setSort(key); setAsc(false); }
  };
  const arrow = asc ? "↑" : "↓";
  const lists = useMemo(() => [0, 1, 2, 3, 4].map((r) => tierList(stats, r)), [stats]);
  const total = lists.reduce((a, l) => a + l.length, 0);
  // banrate : pas encore collecté sur toutes les régions → colonne masquée tant qu'elle serait vide
  const hasBan = useMemo(() => lists.some((l) => l.some((r) => r.banrate != null)), [lists]);
  const sorts = hasBan ? SORTS : SORTS.filter(([k]) => k !== "banrate");
  // classement complet d'abord (le # reste celui de la tier list), puis filtre de recherche
  const ranked = useMemo(() => {
    const value = (r: TierRow) => (sort === "banrate" ? r.banrate ?? -1 : r[sort]);
    return [...(all ? lists.flat() : lists[role])].sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a)))
      .map((r, i) => ({ r, rank: i + 1 }));
  }, [lists, role, all, sort, asc]);
  const q = normalize(query.trim());
  const rows = q ? ranked.filter(({ r }) => normalize(champName(stats, r.champ)).includes(q)) : ranked;
  const scope = all ? t("Tous") : ROLE_LABELS[role];

  return (
    <div className="content">
      <header className="page-head">
        <div>
          <h1>{t("Tier list")}</h1>
        </div>
        <div className="head-actions"><EloBadge matches={Number(stats.meta.matches ?? 0)} />{region}</div>
      </header>

      <div className="tier-controls">
        <Segmented className="segmented" role="tablist" aria-label={t("Rôle")}>
          <button role="tab" aria-selected={all} className={all ? "is-active" : ""} onClick={() => setAll(true)}>
            {t("Tous")} <span className="count">{total}</span>
          </button>
          {ROLE_LABELS.map((label, i) => (
            <button key={label} role="tab" aria-selected={!all && role === i} className={!all && role === i ? "is-active" : ""}
                    onClick={() => { setAll(false); onRole(i); }}>
              {label} <span className="count">{lists[i].length}</span>
            </button>
          ))}
        </Segmented>
        <div className="search-wrap tier-search">
          <svg className="search__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5l3.25 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input className="search" type="search" placeholder={t("Rechercher un champion")} value={query} aria-label={t("Rechercher un champion")}
                 onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          {query && (
            <button className="search__clear" onClick={() => setQuery("")} aria-label={t("Effacer la recherche")} title={t("Effacer")}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.25" />
                <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className={`tier-table${hasBan ? "" : " tier-table--noban"}`} role="table" aria-label={t("Tier list {v}", { v: scope })}>
        <div className="tier-row tier-row--head" role="row">
          <span className="tier-row__rank" role="columnheader">#</span>
          <span className="tier-row__tier" role="columnheader">{t("Tier")}</span>
          <span className="tier-row__champ" role="columnheader">{t("Champion")}</span>
          {sorts.map(([key, label]) => (
            <button key={key} role="columnheader" className={`tier-row__num${sort === key ? " is-sorted" : ""}`}
                    onClick={() => choose(key)} aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}
                    title={sort === key ? (asc ? t("Trier du plus haut au plus bas") : t("Trier du plus bas au plus haut")) : t("Trier par {v}", { v: label })}>
              {label}<span className="tier-sort__arrow" aria-hidden="true">{sort === key ? arrow : "↕"}</span>
            </button>
          ))}
          <span aria-hidden />
        </div>
        <div className="stagger tier-table__rows" key={`${all ? "all" : role}-${sort}-${asc}`}>
        {rows.map(({ r, rank }) => (
          <button key={`${r.champ}-${r.role}`} className="tier-row tier-row--link" role="row" onClick={() => onOpen(r.champ, r.role)}
                  title={t("Ouvrir la page de {champName}", { champName: champName(stats, r.champ) })}>
            <span className="tier-row__rank">{rank}</span>
            <span className={`tier-row__tier tier--${r.tier}`}>{r.tier}</span>
            <span className="tier-row__champ">
              <ChampionIcon stats={stats} champ={r.champ} size={1.75} />
              <span className="tier-row__name">{champName(stats, r.champ)}</span>
              {all && <RoleIcon role={r.role} className="tier-row__role" title={ROLE_LABELS[r.role]} />}
              {r.offRole && (
                <span className="badge badge--muted" title={t("Champion surtout joué dans un autre rôle : son winrate vient souvent de joueurs spécialistes. Limité au tier B.")}>
                  {t("Pick atypique")}
                </span>
              )}
              {!r.offRole && r.niche && (
                <span className="badge badge--muted" title={t("Champion peu joué : son winrate vient souvent de joueurs spécialistes. Limité au tier A.")}>
                  {t("Pick de niche")}
                </span>
              )}
            </span>
            <span className="tier-row__num tier-row__score">{dec1(r.score * 100)}</span>
            <span className={`tier-row__num tier-row__wr tone-${wrTone(r.winrate)}`}>{pct(r.winrate)}<Trend tone={wrTone(r.winrate)} /></span>
            <span className="tier-row__num">{pct(r.pickrate)}</span>
            {hasBan && <span className="tier-row__num">{r.banrate == null ? "—" : pct(r.banrate)}</span>}
            <svg className="tier-row__chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
        </div>
        {rows.length === 0 && (
          <p className="hint">{q ? (all ? t("Aucun champion ne correspond à « {q} ».", { q: query.trim() })
                 : t("Aucun champion ne correspond à « {q} » en {role}.", { q: query.trim(), role: scope }))
            : t("Pas encore assez de parties en {role}. Laisse tourner le collecteur.", { role: scope })}</p>
        )}
      </div>
    </div>
  );
}
