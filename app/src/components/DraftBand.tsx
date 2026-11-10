import { useEffect, useState } from "react";
import { enemyDisplay, roleDistribution, type Stats } from "../lib/score";
import { champName, freshLoadingUrl, freshTileUrl, loadingUrl, iconUrl, pctN, tileUrl } from "../lib/ui";
import { analyzeTeam, type TeamComp } from "../lib/composition";
import { winProbability } from "../lib/winprob";
import { RoleIcon } from "./RoleIcon";
import { t } from "../lib/i18n";
import type { Draft } from "./DraftScreen";

type Slot = { side: "ally" | "enemy"; index: number };

/**
 * Haut de l'écran de draft : bans des deux équipes, probabilité de victoire estimée, les 10 champions en cartes
 * (rôle en dessous) et le profil de dégâts de chaque équipe.
 */
export function DraftBand({ stats, draft, live, onPick }: {
  stats: Stats; draft: Draft; live: boolean;
  /** Démo : clic sur une carte pour choisir le champion. */
  onPick?: (slot: Slot) => void;
}) {
  const allies = draft.allies.map((c, i) => (i === draft.role ? draft.myChamp ?? null : c));
  const picked = allies.flatMap((c, role) => (c != null ? [{ champ: c, role }] : []));
  const enemies = draft.enemies.filter((c): c is number => c != null);
  const p = winProbability(stats, picked, enemies);
  const enemyRows = enemyDisplay(stats, draft.enemies);
  const myComp = analyzeTeam(stats, picked.map((x) => x.champ));
  const theirComp = analyzeTeam(stats, enemies);
  const allyBans = draft.allyBans ?? draft.bans;
  const enemyBans = draft.enemyBans ?? [];
  return (
    <section className="card dband" aria-label={t("Draft")}>
      <div className="dband__top">
        <Bans stats={stats} champs={allyBans} label={t("Bans de ton équipe")} />
        <WinBar p={p} picks={picked.length + enemies.length} />
        <Bans stats={stats} champs={enemyBans} label={t("Bans adverses")} end />
      </div>
      <div className="dband__teams">
        <div className="dband__team">
          {allies.map((c, i) => (
            <DraftCard key={i} stats={stats} champ={c} role={i} me={i === draft.role}
                       picking={draft.allyPicking === i} locked={i === draft.role ? !!draft.myLocked : draft.allyLocked?.[i] ?? true}
                       onClick={!live && i !== draft.role && onPick ? () => onPick({ side: "ally", index: i }) : undefined} />
          ))}
        </div>
        <span className="dband__vs" aria-hidden>VS</span>
        <div className="dband__team">
          {enemyRows.map(({ index: i, role }) => {
            const c = draft.enemies[i];
            const dist = c != null ? roleDistribution(stats, c)[0] : null;
            return (
              <DraftCard key={i} stats={stats} champ={c} role={role} picking={draft.enemyPicking === i} locked
                         guess={c != null && dist && role != null ? t("{role} {p}", { role: ROLE_WORD[role], p: pctN(Math.round(dist.p * 100)) }) : undefined}
                         onClick={!live && onPick ? () => onPick({ side: "enemy", index: i }) : undefined} />
            );
          })}
        </div>
      </div>
      <div className="dband__dmg">
        <Damage comp={myComp} mine />
        <span aria-hidden />
        <Damage comp={theirComp} />
      </div>
    </section>
  );
}

const ROLE_WORD = ["top", "jungle", "mid", "ADC", "support"];

function Bans({ stats, champs, label, end = false }: { stats: Stats; champs: number[]; label: string; end?: boolean }) {
  const slots = [...champs.slice(0, 5), ...Array(Math.max(0, 5 - champs.length)).fill(null)] as (number | null)[];
  return (
    <div className={`dbans${end ? " dbans--end" : ""}`} aria-label={label}>
      {slots.map((c, i) => (
        <span key={i} className={`dbans__slot${c != null ? " is-banned" : ""}`} title={c != null ? champName(stats, c) : undefined}>
          {c != null && <img src={iconUrl(stats, c)} alt={champName(stats, c)} draggable={false} />}
        </span>
      ))}
    </div>
  );
}

function WinBar({ p, picks }: { p: number | null; picks: number }) {
  const ally = p == null ? 50 : Math.round(p * 100);
  const known = p != null && picks > 0;
  return (
    <div className="dwin" title={known ? undefined : t("Le calcul s’affiche dès que le serveur l’a validé sur les parties Master+.")}>
      <div className="dwin__nums">
        <strong className={known ? "dwin__ally" : "muted"}>{known ? pctN(ally) : "—"}</strong>
        <span>{t("Victoire estimée")}</span>
        <strong className={known ? "dwin__enemy" : "muted"}>{known ? pctN(100 - ally) : "—"}</strong>
      </div>
      <div className="dwin__bar" aria-hidden>
        <span className="dwin__a" style={{ flexGrow: known ? ally : 50 }} />
        <span className="dwin__b" style={{ flexGrow: known ? 100 - ally : 50 }} />
      </div>
    </div>
  );
}

// splash art en entier (portrait de chargement à jour, puis Data Dragon), puis vignette en secours
const ART = [freshLoadingUrl, loadingUrl, freshTileUrl, tileUrl];

function DraftCard({ stats, champ, role, me = false, picking, locked, guess, onClick }: {
  stats: Stats; champ: number | null; role: number | null; me?: boolean; picking: boolean; locked: boolean;
  guess?: string; onClick?: () => void;
}) {
  const [step, setStep] = useState(0);   // splash art en entier (portrait de chargement), puis vignette en secours
  useEffect(() => setStep(0), [champ]);
  const cls = `dcard${champ == null ? " dcard--empty" : ""}${me ? " is-me" : ""}${picking ? " is-picking" : ""}${champ != null && !locked ? " is-hover" : ""}`;
  const body = (
    <>
      {champ != null && step < ART.length && (
        <img key={`${champ}-${step}`} className={`dcard__art${step >= 2 ? " dcard__art--tile" : ""}`} alt="" draggable={false}
             src={ART[step](stats, champ)} onError={() => setStep(step + 1)} />
      )}
      {champ == null && role != null && <RoleIcon role={role} className="dcard__ghost" />}
      {me && <span className="dcard__badge">{t("Toi")}</span>}
      {picking && champ == null && <span className="dcard__state">{t("Choisit…")}</span>}
      {champ != null && <span className="dcard__name">{champName(stats, champ)}</span>}
    </>
  );
  return (
    <div className="dslot">
      {onClick
        ? <button className={cls} onClick={onClick} title={champ == null ? t("Clique pour ajouter un pick") : champName(stats, champ)}>{body}</button>
        : <div className={cls}>{body}</div>}
      <span className="dslot__role">
        {role != null ? <RoleIcon role={role} className={`dslot__icon${me ? " is-me" : ""}`} /> : <span className="dslot__icon" />}
        {guess && <small>{guess}</small>}
      </span>
    </div>
  );
}

function Damage({ comp, mine = false }: { comp: TeamComp; mine?: boolean }) {
  if (comp.known < 1) return <div className="ddmg ddmg--empty" />;
  const ad = Math.round(comp.ad * 100), tru = Math.round(comp.tru * 100), ap = Math.max(0, 100 - ad - tru);
  const warn = comp.issues.find((i) => i.gap === "ap" || i.gap === "ad");
  const others = comp.issues.filter((i) => i !== warn);
  return (
    <div className="ddmg" title={warn?.text}>
      <div className="ddmg__head">
        <span className={warn ? "tone-bad" : ""}>{warn ? warn.short : t("Dégâts")}</span>
        <span className="ddmg__legend">
          <span><i className="ddmg__dot ddmg__dot--ad" />AD {pctN(ad)}</span>
          <span><i className="ddmg__dot ddmg__dot--ap" />AP {pctN(ap)}</span>
          {tru > 0 && <span><i className="ddmg__dot ddmg__dot--tru" />{t("Brut")} {pctN(tru)}</span>}
        </span>
      </div>
      <div className="ddmg__bar" aria-hidden>
        <span className="ddmg__ad" style={{ flexGrow: ad }} />
        <span className="ddmg__ap" style={{ flexGrow: ap }} />
        {tru > 0 && <span className="ddmg__tru" style={{ flexGrow: tru }} />}
      </div>
      {/* autres manques (frontline, engage, contrôle) : seulement pour ton équipe, détail au survol */}
      {mine && others.length > 0 && (
        <div className="ddmg__gaps">
          {others.slice(0, 3).map((i) => <span key={i.gap} className={`comp__chip comp__chip--${i.level}`} title={i.text}>✕ {i.short}</span>)}
        </div>
      )}
    </div>
  );
}
