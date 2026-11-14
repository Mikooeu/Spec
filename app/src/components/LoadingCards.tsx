import { useEffect, useState } from "react";
import { loadSpells, useInfo } from "../lib/ddragon";
import { plural, t } from "../lib/i18n";
import type { Duel, LoadingData, LoadPlayer, Tag } from "../lib/loading";
import { pctN } from "../lib/ui";
import { useRuneData, type RuneData } from "./Runes";

const CREST = (tier: string) => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier}.svg`;
export { TIER_COLOR } from "../lib/ui";
import { TIER_COLOR } from "../lib/ui";
const TIER_NAME: Record<string, () => string> = {
  iron: () => t("Fer"), bronze: () => t("Bronze"), silver: () => t("Argent"), gold: () => t("Or"), platinum: () => t("Platine"),
  emerald: () => t("Émeraude"), diamond: () => t("Diamant"), master: () => t("Maître"), grandmaster: () => t("Grand Maître"), challenger: () => t("Challenger"),
};
const TAG: Record<Tag, () => string> = {
  form: () => t("En forme"), tilt: () => t("Série de défaites"), otp: () => t("OTP"), offrole: () => t("Hors rôle"), fresh: () => t("Compte récent"),
};
const TAG_TONE: Record<Tag, string> = { form: "good", tilt: "bad", otp: "neutral", offrole: "neutral", fresh: "bad" };

/** Les 10 cartes de l'écran de chargement. `full` : version plein écran par-dessus le jeu (sans tags ni titres). */
/** Taille du pseudo : réduite pour les noms longs, pour qu'ils tiennent en entier (deux lignes au plus, jamais « … »). */
function nameScale(name: string): number {
  const n = [...name].length;
  return n <= 11 ? 1 : Math.max(0.62, 11 / n);
}

export function LoadingCards({ data, full = false }: { data: LoadingData; full?: boolean }) {
  const spells = useInfo(loadSpells, data.ddragon);
  const runes = useRuneData(data.ddragon);
  const row = (list: LoadPlayer[]) => (
    <div className="lcards__row">
      {list.map((p) => <Card key={p.puuid || p.champ} p={p} runes={runes} spellIcon={(id) => spells?.get(id)?.icon} full={full} />)}
    </div>
  );
  return (
    <div className={`lcards${full ? " lcards--full" : ""}`}>
      {!full && <Label tone="ally">{t("Ton équipe")}</Label>}
      {row(data.allies)}
      <div className="lcards__duels">
        {data.duels.map((d, i) => <DuelMark key={i} d={d} label={!full} />)}
      </div>
      {!full && <Label tone="enemy">{t("Équipe adverse")}</Label>}
      {row(data.enemies)}
    </div>
  );
}

function Label({ tone, children }: { tone: "ally" | "enemy"; children: string }) {
  return <p className="lcards__label"><span className={`lcards__dot lcards__dot--${tone}`} />{children}</p>;
}

function Card({ p, runes, spellIcon, full }: { p: LoadPlayer; runes: RuneData | null; spellIcon: (id: number) => string | undefined; full: boolean }) {
  const key = p.champKey;
  const art = [
    `https://cdn.communitydragon.org/latest/champion/${p.champ}/portrait/skin/${p.champ * 1000 + p.skin}`,
    `https://cdn.communitydragon.org/latest/champion/${p.champ}/portrait`,
    key ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${key}_${p.skin}.jpg` : "",
    key ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${key}_0.jpg` : "",
  ].filter(Boolean);
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [p.champ, p.skin]);
  const wr = p.champGames ? Math.round((p.champWins / p.champGames) * 100) : null;
  const total = p.wins + p.losses;
  const [crestFailed, setCrestFailed] = useState(false);
  return (
    <div className={`lcard${p.me ? " is-me" : ""}`}>
      {step < art.length && <img className="lcard__art" src={art[step]} alt="" draggable={false} onError={() => setStep(step + 1)} />}
      <div className="lcard__shade" />
      <div className="lcard__top">
        <span className="lcard__champ">{p.champName}</span>
        <span className="lcard__games">
          {p.champGames
            ? <>{plural(p.champGames, "{n} partie", "{n} parties")}<span className="lcard__sep"> · </span>
                <strong className={wr! >= 55 ? "tone-good" : wr! <= 45 ? "tone-bad" : ""}>{pctN(wr!)}{full ? " WR" : ""}</strong></>
            : t("1re partie")}
        </span>
        {!full && p.tags.length > 0 && (
          <span className="lcard__tags">{p.tags.map((tg) => <span key={tg} className={`lcard__tag tone-${TAG_TONE[tg]}`}>{TAG[tg]()}</span>)}</span>
        )}
      </div>
      {Math.abs(p.streak) >= 3 && (
        <span className={`lcard__streak ${p.streak > 0 ? "is-win" : "is-loss"}`}>{Math.abs(p.streak)}<Flame /></span>
      )}
      <div className="lcard__bottom">
        <span className="lcard__spells">
          {p.spells.map((s, i) => spellIcon(s) ? <img key={i} src={spellIcon(s)} alt="" draggable={false} /> : <span key={i} />)}
          {p.keystone != null && runes?.get(p.keystone) && (
            <>
              <span className="lcard__divider" aria-hidden />
              <img className="lcard__keystone" src={runes.get(p.keystone)!.icon} alt={runes.get(p.keystone)!.name} title={runes.get(p.keystone)!.name} draggable={false} />
              {p.subStyle != null && runes.get(p.subStyle) && (
                <img className="lcard__substyle" src={runes.get(p.subStyle)!.icon} alt={runes.get(p.subStyle)!.name} title={runes.get(p.subStyle)!.name} draggable={false} />
              )}
            </>
          )}
        </span>
        <span className="lcard__name" style={{ "--ns": nameScale(p.name || p.champName) } as React.CSSProperties}>{p.name || p.champName}</span>
        {/* toujours deux lignes : le rang sur la première, le bilan sur la seconde (même hauteur pour les 10 cartes) */}
        <span className="lcard__rank">
          {p.tier ? (
            <>
              {!crestFailed && <img src={CREST(p.tier)} alt="" draggable={false} onError={() => setCrestFailed(true)} />}
              <strong style={{ color: TIER_COLOR[p.tier] }}>
                {full ? "" : `${TIER_NAME[p.tier]?.() ?? p.tier}${p.division ? ` ${p.division}` : ""} · `}{t("{n} LP", { n: p.lp ?? 0 })}
              </strong>
            </>
          ) : <span className="lcard__wl">{t("Non classé")}</span>}
        </span>
        <span className="lcard__wl lcard__record">
          {p.tier && total > 0 ? `${pctN(Math.round((p.wins / total) * 100))} (${t("{w}V-{l}D", { w: p.wins, l: p.losses })})` : "\u00a0"}
        </span>
      </div>
    </div>
  );
}

function Flame() {
  return (
    <svg viewBox="0 0 18 22" aria-hidden><path d="M9 0C10 4 15 6.5 15 13a6 6 0 0 1-12 0c0-3 1.6-4.8 3-6 .2 2 1.2 3.2 2.4 3.6C7.4 7.5 8.2 3.2 9 0z" fill="currentColor" /></svg>
  );
}

const DUEL_LABEL: Record<Duel, () => string> = {
  up2: () => t("Avantage"), up: () => t("Léger avantage"), eq: () => t("Équilibré"), down: () => t("Désavantage"), down2: () => t("Gros désavantage"),
};
function DuelMark({ d, label }: { d: Duel; label: boolean }) {
  const p = (path: string) => <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />;
  const icon = d === "eq" ? <>{p("M3 7h12")}{p("M3 11h12")}</>
    : d === "up" ? p("M4 11l5-5 5 5") : d === "up2" ? <>{p("M4 8l5-5 5 5")}{p("M4 13l5-5 5 5")}</>
    : d === "down" ? p("M4 7l5 5 5-5") : <>{p("M4 5l5 5 5-5")}{p("M4 10l5 5 5-5")}</>;
  return (
    <span className={`lduel lduel--${d.startsWith("up") ? "good" : d === "eq" ? "eq" : "bad"}`} title={DUEL_LABEL[d]()}>
      <svg viewBox="0 0 18 18" aria-hidden>{icon}</svg>{label && <span>{DUEL_LABEL[d]()}</span>}
    </span>
  );
}
