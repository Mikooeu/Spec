import { EloBadge } from "./EloBadge";
import { useMemo, useState, type ReactNode } from "react";
import { ROLE_LABELS, TIER_MIN_PICKRATE, tierList, type Stats, type TierRow } from "../lib/score";
import { champName, dec1, int, patchLabel, pct, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";
import { Trend } from "./Trend";
import { t } from "../lib/i18n";

type SortKey = "score" | "winrate" | "pickrate" | "banrate";
const SORTS: [SortKey, string][] = [["score", t("Score")], ["winrate", t("Winrate")], ["pickrate", t("Pickrate")], ["banrate", t("Banrate")]];

/** Tier list solo/duo Master+ par rôle. Un clic sur l'en-tête d'une colonne trie (re-clic : ordre inversé). */
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
          <p className="overline">{t("Tier list · solo/duo Master+ {region} · patch {patch}", { region: regionLabel, patch: patchLabel(stats.meta.patch) })}</p>
          <h1>{t("Tier list")}</h1>
        </div>
        <div className="head-actions"><EloBadge />{region}</div>
      </header>

      <div className="tier-controls">
        <Segmented className="segmented" role="tablist" aria-label={t("Rôle")}>
          {ROLE_LABELS.map((label, i) => (
            <button key={label} role="tab" aria-selected={role === i} className={role === i ? "is-active" : ""}
                    onClick={() => onRole(i)}>
              {label} <span className="count">{lists[i].length}</span>
            </button>
          ))}
        </Segmented>
      </div>
      <p className="muted small">{t("Champions joués dans plus de {n} % des parties {role} · {games} parties analysées", { n: Math.round(TIER_MIN_PICKRATE * 100), role: ROLE_LABELS[role], games: int(Number(stats.meta.matches ?? 0)) })}
        {!hasBans && t(" · banrate en cours de collecte")}
        {" · "}{t("Score : winrate corrigé selon le nombre de parties, plus un petit bonus de pick rate et de ban rate")}
      </p>

      <div className="tier-table" role="table" aria-label={t("Tier list {v}", { v: ROLE_LABELS[role] })}>
        <div className="tier-row tier-row--head" role="row">
          <span className="tier-row__rank" role="columnheader">#</span>
          <span className="tier-row__tier" role="columnheader">{t("Tier")}</span>
          <span className="tier-row__champ" role="columnheader">{t("Champion")}</span>
          {SORTS.map(([key, label]) => (
            <button key={key} role="columnheader" className={`tier-row__num${sort === key ? " is-sorted" : ""}`}
                    onClick={() => choose(key)} aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}
                    title={sort === key ? (asc ? t("Trier du plus haut au plus bas") : t("Trier du plus bas au plus haut")) : t("Trier par {v}", { v: label })}>
              {label}<span className="tier-sort__arrow" aria-hidden="true">{sort === key ? arrow : "↕"}</span>
            </button>
          ))}
        </div>
        <div className="stagger tier-table__rows" key={`${role}-${sort}-${asc}`}>
        {rows.map((r, i) => (
          <button key={r.champ} className="tier-row tier-row--link" role="row" onClick={() => onOpen(r.champ, role)}
                  title={t("Ouvrir la page de {champName}", { champName: champName(stats, r.champ) })}>
            <span className="tier-row__rank">{i + 1}</span>
            <span className={`tier-row__tier tier--${r.tier}`}>{r.tier}</span>
            <span className="tier-row__champ">
              <ChampionIcon stats={stats} champ={r.champ} size={1.75} />
              <span className="tier-row__name">{champName(stats, r.champ)}</span>
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
            <span className="tier-row__num">{r.banrate == null ? "—" : pct(r.banrate)}</span>
          </button>
        ))}
        </div>
        {rows.length === 0 && (
          <p className="hint">{t("Pas encore assez de parties en {role}. Laisse tourner le collecteur.", { role: ROLE_LABELS[role] })}</p>
        )}
      </div>
    </div>
  );
}
