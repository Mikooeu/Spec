import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, dec1, int, pct, pctN, wrTone } from "../lib/ui";
import { t, plural } from "../lib/i18n";
import { laneDiff, type Game, type LaneDiff } from "../lib/history";
import { champRows, champScore, kdaOf, perMinute, type GW, type SeasonStats, type SortKey } from "../lib/seasonStats";
import { ChampionIcon } from "./ChampionIcon";
import { Segmented } from "./Segmented";
import { Trend } from "./Trend";

const DAYS = () => [t("Lun"), t("Mar"), t("Mer"), t("Jeu"), t("Ven"), t("Sam"), t("Dim")];
const DAY_NAMES = () => [t("lundi"), t("mardi"), t("mercredi"), t("jeudi"), t("vendredi"), t("samedi"), t("dimanche")];
const rate = ([g, w]: GW) => (g ? w / g : 0);
const signed = (x: number, f: (n: number) => string) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${f(Math.abs(x))}`;

/** Page Stats du profil : côté, abandon, durée, champions, jour de la semaine et écart en lane. */
export function StatsView({ stats, data, laneGames, me, guess, recentNote }: {
  stats: Stats; data: SeasonStats | null;
  /** parties récentes du client (la timeline n'existe que là), dans la file choisie */
  laneGames: Game[]; me: string | null; guess?: (champ: number, notJungle: boolean) => number | null;
  /** phrase courte quand les chiffres ne couvrent que les dernières parties */
  recentNote: string | null;
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
      <div className="tiles tiles--4">
        <SideTile label={t("Winrate côté bleu")} gw={data.sides[0]} missing={missing} />
        <SideTile label={t("Winrate côté rouge")} gw={data.sides[1]} missing={missing} />
        <div className="tile-stat">
          <span className="tile-stat__label">{t("Parties finies par FF")}</span>
          <span className="tile-stat__value">{ff.known ? pctN(Math.round((ff.games / ff.known) * 100)) : "—"}</span>
          <span className="tile-stat__detail">
            {ff.known ? `${plural(ff.games, "{n} partie", "{n} parties")} · ${t("{w} V – {l} D", { w: ff.wins, l: ff.games - ff.wins })}` : missing}
          </span>
        </div>
        <div className="tile-stat" title={t("{a} parties de moins de 30 min, {b} de 30 min ou plus", { a: short[0], b: long[0] })}>
          <span className="tile-stat__label">{t("Winrate selon la durée")}</span>
          <span className="tile-dur">
            <span>{t("Moins de 30 min")}</span>
            <strong className={short[0] ? `tone-${wrTone(rate(short))}` : ""}>{short[0] ? pct(rate(short)) : "—"}</strong>
            <span>{t("Plus de 30 min")}</span>
            <strong className={long[0] ? `tone-${wrTone(rate(long))}` : ""}>{long[0] ? pct(rate(long)) : "—"}</strong>
          </span>
        </div>
      </div>
      <ChampionTable stats={stats} data={data} />
      <div className="sview__row">
        <DayChart days={data.days} season={data.source === "season"} />
        <LaneCard games={laneGames} me={me} guess={guess} />
      </div>
    </div>
  );
}

function SideTile({ label, gw, missing }: { label: string; gw: GW; missing: string }) {
  const tone = gw[0] ? wrTone(rate(gw)) : undefined;
  return (
    <div className="tile-stat">
      <span className="tile-stat__label">{label}</span>
      <span className={`tile-stat__value${tone ? ` tone-${tone}` : ""}`}>{gw[0] ? pct(rate(gw)) : "—"}{tone && <Trend tone={tone} />}</span>
      <span className="tile-stat__detail">{gw[0] ? plural(gw[0], "{n} partie", "{n} parties") : missing}</span>
    </div>
  );
}

const SHOWN = 5;
const scoreTone = (x: number) => (x >= 55 ? "good" : x <= 45 ? "bad" : "neutral");
const COLS: [SortKey, string][] = [["score", "Score"], ["games", "Parties"], ["wr", "Winrate"], ["kda", "KDA"], ["cs", "CS/min"], ["gold", "Or/min"], ["pentas", "Pentas"]];

function ChampionTable({ stats, data }: { stats: Stats; data: SeasonStats }) {
  const [role, setRole] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("games");
  const [asc, setAsc] = useState(false);
  const [all, setAll] = useState(false);   // 5 lignes d'abord, pour voir les stats en dessous sans défiler
  const min = data.source === "season" ? 3 : 1;
  const rows = useMemo(() => champRows(data, role, min, sort, asc), [data, role, min, sort, asc]);
  const count = (r: number | null) => data.champions.filter((c) => r == null || c.role === r).reduce((a, c) => a + c.games, 0);
  const onSort = (k: SortKey) => { if (k === sort) setAsc(!asc); else { setSort(k); setAsc(false); } };
  return (
    <section className="card stable">
      <div className="stable__head">
        <h2>{t("Tes champions")}</h2>
        <Segmented className="segmented" role="tablist" aria-label={t("Rôle")}>
          {[null, 0, 1, 2, 3, 4].map((r) => (
            <button key={String(r)} role="tab" aria-selected={role === r} className={role === r ? "is-active" : ""} onClick={() => setRole(r)}>
              {r == null ? t("Tous") : ROLE_LABELS[r]} <span className="count">{count(r)}</span>
            </button>
          ))}
        </Segmented>
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
                        title={t("Score sur 100 : winrate lissé, puis KDA, CS et or comparés à ta moyenne dans ce rôle. 50 = ton niveau habituel.")}>
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

function DayChart({ days, season }: { days: GW[]; season: boolean }) {
  const W = 700, H = 150, lo = 0.35, hi = 0.65;
  const total = days.reduce((a, d) => a + d[0], 0);
  const y = (v: number) => H - 10 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 20);
  const xs = days.map((_, i) => ((i + 0.5) * W) / 7);
  const pts = days.map((d, i) => (d[0] ? [xs[i], y(rate(d))] : null)).filter(Boolean) as number[][];
  const best = days.reduce((b, d, i) => (d[0] >= 3 && (b < 0 || rate(d) > rate(days[b])) ? i : b), -1);
  return (
    <section className="card sday">
      <div className="sday__head">
        <div>
          <h2>{t("Winrate par jour de la semaine")}</h2>
          <p className="muted small">{season ? t("Sur tes {n} parties classées de la saison", { n: int(total) }) : t("Sur ces {n} parties", { n: int(total) })}</p>
        </div>
        <span className="muted small">{t("pointillés : 50 %")}</span>
      </div>
      <svg className="sday__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Winrate par jour de la semaine")}>
        <defs>
          <linearGradient id="sday-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {pts.length > 1 && <path d={`M${pts[0][0]},${H} L${pts.map((p) => p.join(",")).join(" L")} L${pts[pts.length - 1][0]},${H} Z`} fill="url(#sday-fill)" />}
        <line x1="0" x2={W} y1={y(0.5)} y2={y(0.5)} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 4" />
        {pts.length > 1 && <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {days.map((d, i) => d[0] ? (
          <circle key={i} cx={xs[i]} cy={y(rate(d))} r={i === best ? 5 : 3.5} fill={i === best ? "var(--accent)" : "var(--bg-surface)"} stroke="var(--accent)" strokeWidth="2" />
        ) : null)}
      </svg>
      <div className="sday__days">
        {days.map((d, i) => (
          <span key={i} className={i === best ? "is-best" : ""}>
            <span>{DAYS()[i]}</span>
            <strong className={d[0] ? `tone-${wrTone(rate(d))}` : "muted"}>{d[0] ? pctN(Math.round(rate(d) * 100)) : "—"}</strong>
            <small>{t("{n} p.", { n: d[0] })}</small>
          </span>
        ))}
      </div>
      {best >= 0 && <p className="muted small">{t("Ton meilleur jour : {day} ({wr}, {n}).", { day: DAY_NAMES()[best], wr: pct(rate(days[best])), n: plural(days[best][0], "{n} partie", "{n} parties") })}</p>}
    </section>
  );
}

const LANE_MAX = 20;

function LaneCard({ games, me, guess }: { games: Game[]; me: string | null; guess?: (champ: number, notJungle: boolean) => number | null }) {
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
        <h2>{t("Face à ton vis-à-vis")}</h2>
      </div>
      {!list.length || !me ? <p className="hint">{t("Lance le client LoL : l’écart se lit dans le détail de tes dernières parties.")}</p>
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
                : early != null && late != null && early > 0 && late < 0 ? t("Tu prends l’avantage tôt mais le perds ensuite : pense à convertir avant les premiers objectifs.")
                : early != null && late != null && early < 0 && late > 0 ? t("Tu commences en retard mais tu rattrapes : ton jeu paie sur la durée.")
                : t("Sur {n} parties avec un vis-à-vis identifié.", { n: ok.length })}
            </p>
          </>
        )}
    </section>
  );
}
