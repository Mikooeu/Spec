// Onglet Matchups de la page champion : tes notes et tous les vis-à-vis du rôle, avec ton winrate face à chacun.
import { useMemo, useState } from "react";
import type { Personal } from "../lib/api";
import { t } from "../lib/i18n";
import { getNote, notesFor, useMatchupNotes, withNote } from "../lib/notes";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, int, pct, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { NoteDialog } from "./MatchupNote";

const MIN_LANE_GAMES = 30;   // en dessous, le winrate du vis-à-vis est trop instable pour être montré
export const MIN_PERSO_GAMES = 5; // en dessous, ton winrate s'affiche en gris

type SortKey = "wr" | "games" | "me";

interface Row { enemy: number; name: string; games: number; wr: number; me: [number, number] | null }

export function ChampionMatchups({ stats, champ, role, perso }: { stats: Stats; champ: number; role: number; perso: Personal | null }) {
  const [notes, setNotes] = useMatchupNotes();
  const [query, setQuery] = useState("");
  // par défaut : du matchup le plus dur au plus facile ; un clic sur la même colonne inverse l'ordre
  const [sort, setSort] = useState<SortKey>("wr");
  const [asc, setAsc] = useState(true);
  const choose = (key: SortKey) => {
    if (key === sort) setAsc(!asc);
    else { setSort(key); setAsc(key === "wr"); }
  };
  const [editing, setEditing] = useState<{ enemy: number | null; pick: boolean } | null>(null);

  const rows = useMemo<Row[]>(() => {
    const prefix = `${champ}|${role}|`;
    const out: Row[] = [];
    for (const [k, [g, w]] of stats.lane) {
      if (!k.startsWith(prefix) || g < MIN_LANE_GAMES) continue;
      const enemy = Number(k.slice(prefix.length));
      const me = perso?.matchups.get(`${champ}:${role}:${enemy}`) ?? null;
      out.push({ enemy, name: champName(stats, enemy), games: g, wr: w / g, me: me && me[0] > 0 ? [me[0], me[1]] : null });
    }
    return out;
  }, [stats, champ, role, perso]);
  const sorted = useMemo(() => {
    const value = (r: Row) => (sort === "wr" ? r.wr : sort === "games" ? r.games : r.me ? r.me[1] / r.me[0] : null);
    return [...rows].sort((a, b) => {
      const va = value(a), vb = value(b);
      if (va == null || vb == null) return va == null ? (vb == null ? b.games - a.games : 1) : -1; // jamais affronté : en bas
      return asc ? va - vb : vb - va;
    });
  }, [rows, sort, asc]);

  const shown = query.trim()
    ? sorted.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    : sorted;
  const head = (key: SortKey, label: string) => (
    <th scope="col" className="num" aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}>
      <button className={`mups__sort${sort === key ? " is-sorted" : ""}`} onClick={() => choose(key)}
              title={sort === key ? (asc ? t("Trier du plus haut au plus bas") : t("Trier du plus bas au plus haut")) : t("Trier par {v}", { v: label })}>
        {label}<span className="tier-sort__arrow" aria-hidden="true">{sort === key ? (asc ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
  const mine = notesFor(notes, champ, role);
  const save = (enemy: number, text: string) => { setNotes(withNote(notes, champ, role, enemy, text)); setEditing(null); };
  const champLabel = champName(stats, champ);

  return (
    <>
      <section className="card champ__card">
        <div className="mups__head">
          <h2>{t("Tes notes en {r}", { r: ROLE_LABELS[role] })}</h2>
          {mine.length > 0 && <span className="muted small">{mine.length}</span>}
          <span className="grow" />
          <button className="btn btn--secondary btn--small" onClick={() => setEditing({ enemy: null, pick: true })}>{t("+ Nouvelle note")}</button>
        </div>
        {mine.length === 0 ? (
          <p className="muted small">{t("Pas encore de note sur {c} en {r}. Clique sur « Ajouter » dans un matchup, ou écris-en une pendant ta prochaine draft.", { c: champLabel, r: ROLE_LABELS[role] })}</p>
        ) : (
          <div className="mups__notes">
            {mine.map(([enemy, text]) => (
              <div key={enemy} className="mnote">
                <div className="mnote__head">
                  <span className="mups__who"><ChampionIcon stats={stats} champ={enemy} size={1.75} />{t("Contre {e}", { e: champName(stats, enemy) })}</span>
                  <button className="link-btn" onClick={() => setEditing({ enemy, pick: false })}>{t("Modifier")}</button>
                </div>
                <p className="mnote__text">{text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card champ__card">
        <div className="mups__head">
          <h2>{t("Matchups en {r}", { r: ROLE_LABELS[role] })}</h2>
          <span className="grow" />
          <div className="search-wrap tier-search">
            <svg className="search__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5l3.25 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input className="search" type="search" value={query} placeholder={t("Chercher un adversaire")} aria-label={t("Chercher un adversaire")}
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
        {rows.length === 0 ? (
          <p className="muted small">{t("Pas encore assez de parties de {c} en {r} pour comparer les matchups.", { c: champLabel, r: ROLE_LABELS[role] })}</p>
        ) : (
          <table className="mups__table">
            <thead>
              <tr>
                <th scope="col">{t("Adversaire")}</th>
                {head("wr", t("Winrate Master+"))}
                {head("games", t("Parties"))}
                {head("me", t("Ton winrate"))}
                <th scope="col" className="num">{t("Ta note")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const has = !!getNote(notes, champ, role, r.enemy);
                const meWr = r.me ? r.me[1] / r.me[0] : null;
                return (
                  <tr key={r.enemy}>
                    <td><span className="mups__who"><ChampionIcon stats={stats} champ={r.enemy} size={2} />{r.name}</span></td>
                    <td className={`num tone-${wrTone(r.wr)}`}><strong>{pct(r.wr)}</strong></td>
                    <td className="num muted">{int(r.games)}</td>
                    <td className="num">
                      {r.me && meWr != null ? (
                        <><strong className={r.me[0] >= MIN_PERSO_GAMES ? `tone-${wrTone(meWr)}` : "muted"}>{pct(meWr)}</strong>
                          <span className="muted"> · {r.me[0] > 1 ? t("{n} parties", { n: r.me[0] }) : t("1 partie")}</span></>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="num">
                      <button className={has ? "mups__chip" : "link-btn"} onClick={() => setEditing({ enemy: r.enemy, pick: false })}>
                        {has ? t("✓ Voir la note") : t("+ Ajouter")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <NoteDialog
          title={editing.pick ? t("Nouvelle note · {c} en {r}", { c: champLabel, r: ROLE_LABELS[role] })
                              : t("{a} contre {b}", { a: champLabel, b: champName(stats, editing.enemy ?? null) })}
          hint={editing.enemy != null
            ? t("Affichée en draft et en partie face à {e}, quand tu joues {c} en {r}.", { e: champName(stats, editing.enemy), c: champLabel, r: ROLE_LABELS[role] })
            : t("Choisis l’adversaire, puis écris ce qu’il faut retenir.")}
          initial={editing.enemy != null ? getNote(notes, champ, role, editing.enemy) : ""}
          choices={editing.pick ? rows.map((r) => ({ id: r.enemy, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)) : undefined}
          enemy={editing.enemy}
          onEnemy={(id) => setEditing({ enemy: id, pick: true })}
          onSave={(text) => editing.enemy != null && save(editing.enemy, text)}
          onClose={() => setEditing(null)} />
      )}
    </>
  );
}
