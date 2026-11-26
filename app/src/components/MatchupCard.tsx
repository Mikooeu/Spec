// Carte « Ton matchup » du menu de build en partie (maquette Figma « mode compact », piste 7) :
// quand tu gagnes contre ton vis-à-vis (parties Master+ du matchup découpées par durée) et ce qu'il faut respecter
// (ta note, puis des tendances tirées des stats). Carte fixe, préparée avant la partie : jamais d'alerte (règle Riot).

import { t } from "../lib/i18n";
import type { Stats } from "../lib/score";
import { champName, patchLabel, pct } from "../lib/ui";
import { getNote, useMatchupNotes } from "../lib/notes";
import { MatchupNote } from "./MatchupNote";

const MIN_LANE = 30;     // parties du matchup en dessous desquelles on ne donne pas de chiffres
const MIN_PHASE = 15;    // parties minimum dans une tranche de durée pour l'afficher
const GAP = 0.03;        // écart de winrate entre tranches à partir duquel on en tire une phrase
const LEVEL_FROM = [1, 3, 5, 6, 9, 12];   // tranches de niveau des duels (voir scoring/builds.py, DUEL_LEVELS)
const MIN_DUELS = 6;     // duels (pondérés) minimum dans une tranche pour en parler

export function MatchupCard({ stats, champ, role, enemy, readOnly = false }: { stats: Stats; champ: number; role: number; enemy: number; readOnly?: boolean }) {
  const name = champName(stats, enemy);
  const [lg, lw] = stats.lane.get(`${champ}|${role}|${enemy}`) ?? [0, 0];
  const wr = lg >= MIN_LANE ? lw / lg : null;

  // quand tu gagnes : avant 20 min, de 20 à 30 min, après 30 min
  const row = stats.champPages.get(`${champ}|${role}`)?.lengthVs?.find((r) => r[0] === enemy);
  const phases = row ? ([[t("Avant 20 min"), row[1], row[2]], [t("20 à 30 min"), row[3], row[4]], [t("Après 30 min"), row[5], row[6]]] as const)
    .map(([label, g, w], i) => ({ i, label, g, wr: g >= MIN_PHASE ? w / g : null })) : [];
  const shown = phases.filter((p) => p.wr != null);
  let advice: string | null = null;
  if (shown.length >= 2) {
    const best = shown.reduce((a, b) => (b.wr! > a.wr! ? b : a)), worst = shown.reduce((a, b) => (b.wr! < a.wr! ? b : a));
    if (best.wr! - worst.wr! >= GAP) {
      advice = best.i === 0 ? t("Tu gagnes plus souvent quand la partie se joue tôt : prends l’avantage avant 20 min.")
        : best.i === 2 ? t("Tu gagnes plus souvent quand la partie dure : joue sûr tôt, ton moment vient après 30 min.")
        : t("Ton meilleur moment est entre 20 et 30 min, quand les objectifs se jouent.");
    }
  }

  // à respecter : ce que disent les 1v1 entre vis-à-vis (kills sans aide, selon TON niveau au moment du kill)
  const tips = duelTips(stats, champ, role, enemy, name);
  const [notes] = useMatchupNotes();
  const hasNote = !!getNote(notes, champ, role, enemy);

  return (
    <section className="ig2-card mcard">
      <div className="mcard__head">
        <h2 className="mcard__title">{t("Ton matchup : contre {e}", { e: name })}</h2>
        {wr != null && <span className={`mcard__wr tone-${wr >= 0.515 ? "good" : wr <= 0.485 ? "bad" : "neutral"}`}>{pct(wr)}</span>}
      </div>
      <small className="muted">
        {lg >= MIN_LANE ? t("{n} parties Master+ · patch {p}", { n: Math.round(lg).toLocaleString(), p: patchLabel(stats.meta.patch) })
          : t("Pas encore assez de parties Master+ de ce matchup.")}
      </small>

      {shown.length >= 2 && (
        <>
          <h3 className="mcard__sub">{t("Quand tu gagnes")}</h3>
          <div className="mcard__phases">
            {phases.map((p) => (
              <div key={p.i} className="mcard__phase">
                <span>{p.label}</span>
                <span className="mcard__bar"><i className={p.wr == null ? "" : `tone-bg-${p.wr >= 0.5 ? "good" : "bad"}`} style={{ width: `${(p.wr ?? 0) * 100}%` }} /></span>
                <strong className={p.wr == null ? "muted" : `tone-${p.wr >= 0.5 ? "good" : "bad"}`}>{p.wr == null ? "—" : pct(p.wr)}</strong>
              </div>
            ))}
          </div>
          {advice && <p className="mcard__advice">{advice}</p>}
        </>
      )}

      {(!readOnly || tips.lines.length > 0 || hasNote) && <h3 className="mcard__sub">{t("À respecter")}</h3>}
      <MatchupNote stats={stats} champ={champ} role={role} enemy={enemy} readOnly={readOnly} />
      {tips.lines.length > 0 && (
        <div className="mcard__trend">
          {tips.lines.map((x) => <p key={x.text} className={x.tone ? `mcard__tip mcard__tip--${x.tone}` : "mcard__tip"}>{x.text}</p>)}
        </div>
      )}
    </section>
  );
}

type Tip = { text: string; tone?: "bad" | "good" };

/** Conseils tirés des 1v1 entre vis-à-vis en Master+ : all-in à craindre tôt, niveau à partir duquel tu gagnes le duel. */
function duelTips(stats: Stats, champ: number, role: number, enemy: number, name: string): { games: number; lines: Tip[] } {
  const row = stats.champPages.get(`${champ}|${role}`)?.duels?.find((r) => r[0] === enemy);
  if (!row) return { games: 0, lines: [] };
  const n = LEVEL_FROM.length, games = row[1];
  const win = row.slice(2, 2 + n), lose = row.slice(2 + n, 2 + 2 * n);
  const lines: Tip[] = [];
  let turnAt: number | null = null;   // niveau où le duel tourne, déjà annoncé
  // all-in tôt : il te tue en 1v1 avant le niveau 5
  const earlyLose = lose[0] + lose[1], earlyWin = win[0] + win[1];
  if (earlyLose >= MIN_DUELS && earlyLose / games >= 0.08 && earlyLose >= 1.3 * earlyWin) {
    lines.push({ tone: "bad", text: t("Attention au all-in {lv} : {c} te tue en 1v1 avant le niveau 5 dans {p} des parties.",
      { lv: lose[0] >= lose[1] ? t("niveau 2") : t("niveau 3-4"), c: name, p: pct(earlyLose / games) }) });
  }
  // à partir de quel niveau le duel tourne
  const share = LEVEL_FROM.map((_, i) => (win[i] + lose[i] >= MIN_DUELS ? win[i] / (win[i] + lose[i]) : null));
  const known = share.map((v, i) => ({ v, i })).filter((x) => x.v != null) as { v: number; i: number }[];
  if (known.length >= 2) {
    const turnFor = (good: boolean) => known.find((x, k) => (good ? x.v >= 0.55 : x.v <= 0.45) && k > 0
      && known.slice(k).every((y) => (good ? y.v >= 0.5 : y.v <= 0.5)) && known.slice(0, k).some((y) => (good ? y.v < 0.5 : y.v > 0.5)));
    const after = (i: number) => { const w = win.slice(i).reduce((a, b) => a + b, 0), l = lose.slice(i).reduce((a, b) => a + b, 0); return w / Math.max(1, w + l); };
    const mine = turnFor(true), his = turnFor(false);
    turnAt = mine ? LEVEL_FROM[mine.i] : his ? LEVEL_FROM[his.i] : null;
    const total = known.reduce((a, x) => a + win[x.i] + lose[x.i], 0), wins = known.reduce((a, x) => a + win[x.i], 0);
    if (mine) lines.push({ tone: "good", text: t("Tu gagnes le 1v1 à partir du niveau {lv} ({p} des duels ensuite).", { lv: LEVEL_FROM[mine.i], p: pct(after(mine.i)) }) });
    else if (his) lines.push({ tone: "bad", text: t("{c} gagne le 1v1 à partir du niveau {lv} : prends l’avantage avant.", { c: name, lv: LEVEL_FROM[his.i] }) });
    else if (wins / total >= 0.56) lines.push({ tone: "good", text: t("Tu gagnes la plupart des 1v1 ({p}) : cherche les échanges.", { p: pct(wins / total) }) });
    else if (wins / total <= 0.44) lines.push({ tone: "bad", text: t("{c} gagne la plupart des 1v1 ({p}) : évite les échanges longs.", { c: name, p: pct(1 - wins / total) }) });
  }
  // son niveau 6, quand il retourne le duel
  if (share[2] != null && share[3] != null && share[2] >= 0.5 && share[3] <= 0.42 && turnAt !== 6)
    lines.push({ tone: "bad", text: t("Attention à son niveau 6 : {c} gagne {p} des 1v1 entre les niveaux 6 et 8.", { c: name, p: pct(1 - share[3]) }) });
  return { games, lines: lines.slice(0, 3) };
}
