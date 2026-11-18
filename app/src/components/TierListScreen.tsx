import { Chip, TopBar } from "./TopBar";
import { EloBadge } from "./EloBadge";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { Personal } from "../lib/api";
import { loadItems, useInfo } from "../lib/ddragon";
import { ItemIcon, withBoots } from "./ChampionScreen";
import { ROLE_LABELS, gamesIn, tierList, type Stats, type TierRow } from "../lib/score";
import { champName, dec1, normalize, pct, wrTone } from "../lib/ui";
import { RoleIcon } from "./RoleIcon";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";
import { plural, t } from "../lib/i18n";

type SortKey = "score" | "winrate" | "pickrate" | "banrate" | "presence";
const SORTS: [SortKey, string][] = [["score", t("Score")], ["winrate", t("Winrate")], ["pickrate", t("Pick")], ["banrate", t("Ban")], ["presence", t("Présence")]];

/** Tier list solo/duo Master+ par rôle. Un clic sur l'en-tête d'une colonne trie (re-clic : ordre inversé). */
export function TierListScreen({ stats, role, onRole, onOpen, region, perso = null }:
  { stats: Stats; role: number; onRole: (role: number) => void; onOpen: (champ: number, role: number) => void;
    region?: ReactNode; regionLabel?: string; perso?: Personal | null }) {
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
    const value = (r: TierRow) => (sort === "banrate" ? r.banrate ?? -1 : sort === "presence" ? r.pickrate + (r.banrate ?? 0) : r[sort]);
    return [...(all ? lists.flat() : lists[role])].sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a)))
      .map((r, i) => ({ r, rank: i + 1 }));
  }, [lists, role, all, sort, asc]);
  const q = normalize(query.trim());
  const rows = q ? ranked.filter(({ r }) => normalize(champName(stats, r.champ)).includes(q)) : ranked;
  const scope = all ? t("Tous") : ROLE_LABELS[role];
  // triée par score : les lignes sont regroupées par tier
  const grouped = sort === "score" && !q;
  const tierCount = useMemo(() => { const m = new Map<string, number>(); for (const { r } of ranked) m.set(r.tier, (m.get(r.tier) ?? 0) + 1); return m; }, [ranked]);
  const maxPresence = useMemo(() => Math.max(0.01, ...ranked.map(({ r }) => r.pickrate + (r.banrate ?? 0))), [ranked]);
  // aperçu à droite : la ligne cliquée, sinon la première
  const [picked, setPicked] = useState<{ champ: number; role: number } | null>(null);
  const sel = rows.find(({ r }) => r.champ === picked?.champ && r.role === picked?.role)?.r ?? rows[0]?.r ?? null;

  return (
    <div className="content">
      <TopBar title={t("Tier list")}>
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
        <span className="grow" />
        <EloBadge matches={Number(stats.meta.matches ?? 0)} />{region}
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
      </TopBar>

      <div className="tl2">
        <div className="tl2-table" role="region" aria-label={t("Tier list {v}", { v: scope })}>
          <div className={`tl2-row tl2-row--head${hasBan ? "" : " tl2-row--noban"}`}>
            <span aria-hidden="true">#</span>
            <span aria-hidden="true">{t("Champion")}</span>
            {sorts.map(([key, label]) => (
              <button key={key} className={`tl2-sort${sort === key ? " is-sorted" : ""}`}
                      onClick={() => choose(key)} aria-pressed={sort === key}
                      title={sort === key ? (asc ? t("Trier du plus haut au plus bas") : t("Trier du plus bas au plus haut")) : t("Trier par {v}", { v: label })}>
                {label}{sort === key && <span aria-hidden="true"> {arrow}</span>}
              </button>
            ))}
          </div>
          <div key={`${all ? "all" : role}-${sort}-${asc}`}>
            {rows.map(({ r, rank }, i) => {
              const on = sel != null && sel.champ === r.champ && sel.role === r.role;
              const presence = r.pickrate + (r.banrate ?? 0);
              return (
                <Fragment key={`${r.champ}-${r.role}`}>
                  {grouped && rows[i - 1]?.r.tier !== r.tier && (
                    <div className="tl2-group">
                      <span className={`tl2-group__tier tier--${r.tier}`}>{t("Tier {tier}", { tier: r.tier })}</span>
                      <span>{plural(tierCount.get(r.tier) ?? 0, "{n} champion", "{n} champions")}</span>
                    </div>
                  )}
                  <button className={`tl2-row tl2-row--link${on ? " is-active" : ""}${hasBan ? "" : " tl2-row--noban"}`}
                          onClick={() => setPicked({ champ: r.champ, role: r.role })} onDoubleClick={() => onOpen(r.champ, r.role)} aria-pressed={on}
                          aria-label={t("{n}. {c}, tier {tier}, {wr} de victoires", { n: rank, c: champName(stats, r.champ), tier: r.tier, wr: pct(r.winrate) })}>
                    <span className="tl2-row__rank">{rank}</span>
                    <span className="tl2-row__champ">
                      <ChampionIcon stats={stats} champ={r.champ} size={2} />
                      <span className="tl2-row__name">{champName(stats, r.champ)}</span>
                      {all && <RoleIcon role={r.role} className="tier-row__role" title={ROLE_LABELS[r.role]} />}
                      {!grouped && <span className={`tl2-group__tier tier--${r.tier}`}>{r.tier}</span>}
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
                    <span className="tl2-row__score">{dec1(r.score * 100)}</span>
                    <span className={`tl2-row__wr tone-${wrTone(r.winrate)}`}>{pct(r.winrate)}</span>
                    <span className="tl2-row__num">{pct(r.pickrate)}</span>
                    {hasBan && <span className="tl2-row__num">{r.banrate == null ? "—" : pct(r.banrate)}</span>}
                    <span className="tl2-row__bar" title={t("Présence : {v} des parties (pick + ban)", { v: pct(presence) })}><i style={{ width: `${Math.max(4, Math.min(100, (presence / maxPresence) * 100))}%` }} /></span>
                  </button>
                </Fragment>
              );
            })}
          </div>
          {rows.length === 0 && (
            <p className="hint tl2-empty">{q ? (all ? t("Aucun champion ne correspond à « {q} ».", { q: query.trim() })
                   : t("Aucun champion ne correspond à « {q} » en {role}.", { q: query.trim(), role: scope }))
              : t("Pas encore assez de parties en {role}. Laisse tourner le collecteur.", { role: scope })}</p>
          )}
        </div>
        {sel && <Preview stats={stats} row={sel} perso={perso} onOpen={() => onOpen(sel.champ, sel.role)} />}
      </div>
    </div>
  );
}

const MIN_LANE_GAMES = 30;

/** Aperçu du champion sélectionné : ses chiffres, son build le plus joué, ses meilleurs et pires matchups. */
function Preview({ stats, row, perso, onOpen }: { stats: Stats; row: TierRow; perso: Personal | null; onOpen: () => void }) {
  const items = useInfo(loadItems, stats.ddragon);
  const { champ, role } = row;
  const page = stats.champPages.get(`${champ}|${role}`) ?? null;
  const all = [0, 1, 2, 3, 4].reduce((a, r) => a + gamesIn(stats, champ, r), 0);
  const roleShare = all ? gamesIn(stats, champ, role) / all : 0;
  const me = perso?.byRole.get(`${champ}:${role}`) ?? null;
  const seq = page?.builds[0]?.[0] ? withBoots(page.builds[0][0], page) : [];
  const lanes = useMemo(() => {
    const prefix = `${champ}|${role}|`;
    const out: { enemy: number; wr: number }[] = [];
    for (const [k, [g, w]] of stats.lane) if (k.startsWith(prefix) && g >= MIN_LANE_GAMES) out.push({ enemy: Number(k.slice(prefix.length)), wr: w / g });
    return out.sort((a, b) => b.wr - a.wr);
  }, [stats, champ, role]);
  const strong = lanes.filter((l) => l.wr > 0.5).slice(0, 3), weak = lanes.filter((l) => l.wr < 0.5).slice(-3).reverse();
  const name = champName(stats, champ);
  const side = (title: string, list: { enemy: number; wr: number }[], tone: string) => (
    <div className="tl2-prev__side">
      <h3>{title}</h3>
      {list.length ? list.map((l) => (
        <span key={l.enemy} className="tl2-prev__vs" title={champName(stats, l.enemy)}>
          <ChampionIcon stats={stats} champ={l.enemy} size={1.625} /><strong className={`tone-${tone}`}>{pct(l.wr)}</strong>
        </span>
      )) : <span className="muted small">—</span>}
    </div>
  );
  return (
    <aside className="tl2-prev" aria-label={t("Aperçu de {c}", { c: name })}>
      <div className="tl2-prev__head">
        <ChampionIcon stats={stats} champ={champ} size={2.4} />
        <div>
          <h2>{name}</h2>
          <span className="tl2-prev__tags">
            <span className={`tl2-group__tier tier--${row.tier}`}>{t("Tier {tier}", { tier: row.tier })}</span>
            <Chip>{ROLE_LABELS[role]} · {pct(roleShare).replace(/[,.]\d/, "")}</Chip>
          </span>
        </div>
      </div>
      <div className="tl2-prev__tiles">
        <div><strong className={`tone-${wrTone(row.winrate)}`}>{pct(row.winrate)}</strong><span>{t("Winrate")}</span></div>
        <div><strong>{pct(row.pickrate)}</strong><span>{t("Pick")}</span></div>
        {row.banrate != null && <div><strong>{pct(row.banrate)}</strong><span>{t("Ban")}</span></div>}
      </div>
      {me && me[0] > 0 && (
        <p className="tl2-prev__me"><strong>{t("Toi")}</strong>{me[0] > 1 ? t("{wr} sur {n} parties", { wr: pct(me[1] / me[0]), n: me[0] }) : t("{wr} sur 1 partie", { wr: pct(me[1] / me[0]) })}</p>
      )}
      {seq.length > 0 && (
        <>
          <h3>{t("Build le plus joué")}</h3>
          <div className="tl2-prev__build">{seq.map((id, i) => <ItemIcon key={`${id}-${i}`} id={id} data={items} />)}</div>
        </>
      )}
      {lanes.length > 0 && <div className="tl2-prev__sides">{side(t("Fort contre"), strong, "good")}{side(t("Faible contre"), weak, "bad")}</div>}
      <button className="btn btn--primary tl2-prev__open" onClick={onOpen}>{t("Ouvrir la page de {champName}", { champName: name })}</button>
    </aside>
  );
}
