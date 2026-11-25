// Carte « Ton matchup » du menu de build en partie (maquette Figma « mode compact », piste 7) :
// quand tu gagnes contre ton vis-à-vis (parties Master+ du matchup découpées par durée) et ce qu'il faut respecter
// (ta note, puis des tendances tirées des stats). Carte fixe, préparée avant la partie : jamais d'alerte (règle Riot).

import type { InfoMap } from "../lib/ddragon";
import { t } from "../lib/i18n";
import type { Stats } from "../lib/score";
import { champName, patchLabel, pct } from "../lib/ui";
import { MatchupNote } from "./MatchupNote";

const MIN_LANE = 30;     // parties du matchup en dessous desquelles on ne donne pas de chiffres
const MIN_PHASE = 15;    // parties minimum dans une tranche de durée pour l'afficher
const GAP = 0.03;        // écart de winrate entre tranches à partir duquel on en tire une phrase
const IGNITE = 14, EXHAUST = 3, TELEPORT = 12;

export function MatchupCard({ stats, champ, role, enemy, items, spells }:
  { stats: Stats; champ: number; role: number; enemy: number; items: InfoMap | null; spells: InfoMap | null }) {
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

  // à respecter : tendances de ton adversaire, tirées de ses parties Master+ dans le même rôle
  const trends: string[] = [];
  const foe = stats.champPages.get(`${enemy}|${role}`);
  if (foe?.spells.length) {
    const total = foe.spells.reduce((a, s) => a + s[2], 0);
    for (const [id, verb] of [[IGNITE, t("Embrasement")], [EXHAUST, t("Fatigue")], [TELEPORT, t("Téléportation")]] as const) {
      const share = total ? foe.spells.filter((s) => s[0] === id || s[1] === id).reduce((a, s) => a + s[2], 0) / total : 0;
      if (share >= 0.4) { trends.push(t("{c} prend {s} dans {p} des parties.", { c: name, s: spells?.get(id)?.name ?? verb, p: pct(share) })); break; }
    }
  }
  const first = foe?.items[0]?.[1]?.slice().sort((a, b) => b[1] - a[1])[0];
  if (first && items?.get(first[0])) trends.push(t("Son premier objet habituel : {i}.", { i: items.get(first[0])!.name }));
  const dmg = stats.damage.get(enemy);
  if (dmg && dmg[3] >= MIN_LANE) {
    const [ad, ap] = dmg;
    if (ap >= 0.65) trends.push(t("Dégâts surtout magiques ({p}).", { p: pct(ap) }));
    else if (ad >= 0.65) trends.push(t("Dégâts surtout physiques ({p}).", { p: pct(ad) }));
  }

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

      <h3 className="mcard__sub">{t("À respecter")}</h3>
      <MatchupNote stats={stats} champ={champ} role={role} enemy={enemy} />
      {trends.length > 0 && (
        <div className="mcard__trend">
          <span className="mcard__trend-label">{t("Tendance des stats")}</span>
          {trends.slice(0, 2).map((x) => <p key={x}>{x}</p>)}
        </div>
      )}
    </section>
  );
}
