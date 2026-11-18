import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, dec1, int, pct, pctN, wrTone } from "../lib/ui";
import { t, plural } from "../lib/i18n";
import { laneDiff, type Game, type LaneDiff } from "../lib/history";
import { champRows, champScore, kdaOf, perMinute, type GW, type SeasonStats, type SortKey } from "../lib/seasonStats";
import { ChampionIcon } from "./ChampionIcon";

const DAYS = () => [t("Lun"), t("Mar"), t("Mer"), t("Jeu"), t("Ven"), t("Sam"), t("Dim")];
const DAY_NAMES = () => [t("lundi"), t("mardi"), t("mercredi"), t("jeudi"), t("vendredi"), t("samedi"), t("dimanche")];
const rate = ([g, w]: GW) => (g ? w / g : 0);
const signed = (x: number, f: (n: number) => string) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${f(Math.abs(x))}`;

/** Page Stats du profil : côté, abandon, durée, champions, jour de la semaine et écart en lane. */
export function StatsView({ stats, data, laneGames, me, guess, recentNote, other = false, role = null }: {
  stats: Stats; data: SeasonStats | null;
  /** parties récentes du client (la timeline n'existe que là), dans la file choisie */
  laneGames: Game[]; me: string | null; guess?: (champ: number, notJungle: boolean) => number | null;
  /** phrase courte quand les chiffres ne couvrent que les dernières parties */
  recentNote: string | null;
  /** profil d'un autre joueur : textes à la 3e personne */
  other?: boolean;
  /** rôle choisi dans le filtre en haut du profil (null = tous) */
  role?: number | null;
}) {
  if (!data) return <div className="skeleton" aria-label={t("Chargement des stats")}>{[0, 1, 2].map((i) => <span key={i} />)}</div>;
  if (!data.games) return <p className="hint">{t("Pas encore de partie à analyser dans cette file.")}</p>;
  const [short, long] = data.duration;
  const ff = data.surrender;
  // côté et abandon : absents des parties d'avant la 0.5 tant que le serveur ne les a pas relues
  const missing = data.source === "season" ? t("Relecture des parties en cours") : t("Non renvoyé par le client");
  return (
    <div className="sview">
      {recentNote && <p className="muted small">{recentNote}</p>}
      {(() => {
        // côté et abandon : affichés seulement si le client les renvoie (ou pendant la relecture des parties)
        const season = data.source === "season";
        const sides = season || data.sides[0][0] + data.sides[1][0] > 0;
        const ffShown = season || ff.known > 0;
        const n = 1 + (sides ? 2 : 0) + (ffShown ? 1 : 0);
        return (
          <div className="pf-tiles" data-n={n}>
            {sides && <SideTile label={t("Winrate côté bleu")} gw={data.sides[0]} missing={missing} />}
            {sides && <SideTile label={t("Winrate côté rouge")} gw={data.sides[1]} missing={missing} />}
            <SideTile label={t("Parties de moins de 30 min")} gw={short} missing="—" />
            <SideTile label={t("Parties de 30 min ou plus")} gw={long} missing="—" />
            {ffShown && (
              <div className="pf-tile">
                <span>{t("Parties finies par FF")}</span>
                <strong>{ff.known ? pctN(Math.round((ff.games / ff.known) * 100)) : "—"}</strong>
                <small>{ff.known ? `${plural(ff.games, "{n} partie", "{n} parties")} · ${t("{w} V – {l} D", { w: ff.wins, l: ff.games - ff.wins })}` : missing}</small>
              </div>
            )}
          </div>
        );
      })()}
      <ChampionTable stats={stats} data={data} other={other} role={role} />
      <LaneCard games={laneGames} me={me} guess={guess} other={other} />
    </div>
  );
}

function SideTile({ label, gw, missing }: { label: string; gw: GW; missing: string }) {
  const tone = gw[0] ? wrTone(rate(gw)) : undefined;
  return (
    <div className="pf-tile">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : ""}>{gw[0] ? pct(rate(gw)).replace(/[,.]\d/, "") : "—"}</strong>
      <small>{gw[0] ? plural(gw[0], "{n} partie", "{n} parties") : missing}</small>
    </div>
  );
}

/** Winrate par jour de la semaine, en barres (colonne de gauche du profil). */
export function DayBars({ days }: { days: GW[] }) {
  if (!days.some((d) => d[0])) return null;
  const h = (d: GW) => (d[0] ? 14 + Math.round(Math.min(1, Math.max(0, (rate(d) - 0.3) / 0.4)) * 44) : 4);
  return (
    <section className="pf-card">
      <h2>{t("Winrate par jour")}</h2>
      <div className="pf-days">
        {days.map((d, i) => (
          <span key={i} title={d[0] ? `${DAY_NAMES()[i]} · ${pct(rate(d))} · ${plural(d[0], "{n} partie", "{n} parties")}` : DAY_NAMES()[i]}>
            <small>{d[0] ? pctN(Math.round(rate(d) * 100)) : "—"}</small>
            <i className={d[0] >= 3 ? `tone-bg-${wrTone(rate(d))}` : ""} style={{ height: `${h(d)}px` }} />
            <b>{DAYS()[i].slice(0, 1)}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

const SHOWN = 5;
const scoreTone = (x: number) => (x >= 55 ? "good" : x <= 45 ? "bad" : "neutral");
const COLS: [SortKey, string][] = [["score", "Score"], ["games", "Parties"], ["wr", "Winrate"], ["kda", "KDA"], ["cs", "CS/min"], ["gold", "Or/min"], ["pentas", "Pentas"]];

function ChampionTable({ stats, data, other, role }: { stats: Stats; data: SeasonStats; other: boolean; role: number | null }) {
  const [sort, setSort] = useState<SortKey>("games");
  const [asc, setAsc] = useState(false);
  const [all, setAll] = useState(false);   // 5 lignes d'abord, pour voir les stats en dessous sans défiler
  const min = data.source === "season" ? 3 : 1;
  const rows = useMemo(() => champRows(data, role, min, sort, asc), [data, role, min, sort, asc]);
  const onSort = (k: SortKey) => { if (k === sort) setAsc(!asc); else { setSort(k); setAsc(false); } };
  return (
    <section className="card stable">
      <div className="stable__head">
        <h2>{other ? t("Ses champions") : t("Tes champions")}</h2>

      </div>
      {rows.length ? (
        <div className="stable__table" role="table">
          <div className="stable__row stable__row--head" role="row">
            <span role="columnheader">{t("Champion")}</span>
            {COLS.map(([k, label]) => (
              <button key={k} role="columnheader" className={sort === k ? "is-sorted" : ""} onClick={() => onSort(k)}
                      title={t("Trier par {v}", { v: t(label) })} aria-sort={sort === k ? (asc ? "ascending" : "descending") : "none"}>
                {t(label)} <span aria-hidden>{sort === k ? (asc ? "↑" : "↓") : "↕"}</span>
              </button>
            ))}
          </div>
          {(all ? rows : rows.slice(0, SHOWN)).map((c) => {
            const wr = c.wins / c.games;
            return (
              <div key={`${c.champ}:${c.role}`} className="stable__row" role="row">
                <span className="stable__champ">
                  <ChampionIcon stats={stats} champ={c.champ} size={1.75} />
                  <span>
                    <strong>{champName(stats, c.champ)}</strong>
                    <small>{c.role >= 0 ? ROLE_LABELS[c.role] : t("Rôle inconnu")}</small>
                  </span>
                </span>
                <strong className={`stable__score tone-${scoreTone(champScore(c, data.champions))}`}
                        title={other ? t("Score sur 100 : winrate lissé, puis KDA, CS et or comparés à sa moyenne dans ce rôle. 50 = son niveau habituel.")
                          : t("Score sur 100 : winrate lissé, puis KDA, CS et or comparés à ta moyenne dans ce rôle. 50 = ton niveau habituel.")}>
                  {champScore(c, data.champions)}</strong>
                <span>{int(c.games)}</span>
                <strong className={`tone-${wrTone(wr)}`}>{pct(wr)}</strong>
                <span>{dec1(kdaOf(c))}</span>
                <span>{dec1(perMinute(c.cs, c.seconds))}</span>
                <span>{int(perMinute(c.gold, c.seconds))}</span>
                <span className={c.pentas ? "" : "muted"}>{c.pentas ? int(c.pentas) : "—"}</span>
              </div>
            );
          })}
        </div>
      ) : <p className="hint">{t("Aucun champion avec au moins {min} parties dans ce rôle.", { min: min })}</p>}
      {rows.length > SHOWN && (
        <button className="btn btn--secondary stable__more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? t("Voir moins") : t("Voir les {n} champions", { n: rows.length })}
        </button>
      )}
    </section>
  );
}

const LANE_MAX = 20;

function LaneCard({ games, me, guess, other }: { games: Game[]; me: string | null; guess?: (champ: number, notJungle: boolean) => number | null; other: boolean }) {
  const list = useMemo(() => games.filter((g) => !g.remake && g.role != null).slice(0, LANE_MAX), [games]);
  const [diffs, setDiffs] = useState<(LaneDiff | null)[]>([]);
  const [failed, setFailed] = useState(false);
  const ids = list.map((g) => g.id).join(",");
  useEffect(() => {
    if (!me || !list.length) return;
    let alive = true;
    setDiffs([]); setFailed(false);
    (async () => {
      const out: (LaneDiff | null)[] = [];
      for (const g of list) {   // une partie à la fois : le client LoL reste fluide
        try { out.push(await laneDiff(g.id, me, guess)); } catch { if (alive) setFailed(true); return; }
        if (!alive) return;
        setDiffs([...out]);
      }
    })();
    return () => { alive = false; };
  }, [ids, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = diffs.filter(Boolean) as LaneDiff[];
  const avg = (k: number) => { const v = ok.map((d) => d[k]).filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const cells: [string, number | null, (n: number) => string][] = [
    [t("CS à 15 min"), avg(0), dec1], [t("CS à 25 min"), avg(2), dec1],
    [t("Or à 15 min"), avg(1), (n) => int(n)], [t("Or à 25 min"), avg(3), (n) => int(n)],
  ];
  const loading = !failed && diffs.length < list.length;
  const early = avg(1), late = avg(3);
  return (
    <section className="card slane">
      <div>
        <h2>{other ? t("Face à son vis-à-vis") : t("Face à ton vis-à-vis")}</h2>
      </div>
      {!list.length || !me ? <p className="hint">{other ? t("Lance le client LoL : l’écart se lit dans le détail de ses dernières parties.") : t("Lance le client LoL : l’écart se lit dans le détail de tes dernières parties.")}</p>
        : failed && !ok.length ? <p className="hint">{t("Le client LoL n’a pas renvoyé le détail des parties. Réessaie dans un instant.")}</p>
        : (
          <>
            <div className="slane__grid">
              {cells.map(([label, v, f]) => (
                <div key={label} className="slane__cell">
                  <span>{label}</span>
                  <strong className={v == null ? "muted" : v > 0 ? "tone-good" : v < 0 ? "tone-bad" : ""}>{v == null ? "—" : signed(v, f)}</strong>
                </div>
              ))}
            </div>
            <p className="muted small">
              {loading ? t("Lecture du détail des parties… {a}/{b}", { a: diffs.length, b: list.length })
                : early != null && late != null && early > 0 && late < 0 ? (other ? t("Prend l’avantage tôt mais le perd ensuite.") : t("Tu prends l’avantage tôt mais le perds ensuite : pense à convertir avant les premiers objectifs."))
                : early != null && late != null && early < 0 && late > 0 ? (other ? t("Commence en retard mais rattrape sur la durée.") : t("Tu commences en retard mais tu rattrapes : ton jeu paie sur la durée."))
                : t("Sur {n} parties avec un vis-à-vis identifié.", { n: ok.length })}
            </p>
          </>
        )}
    </section>
  );
}
