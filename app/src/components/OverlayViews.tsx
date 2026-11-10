import { useEffect, useState } from "react";
import { loadItems, useInfo, type InfoMap } from "../lib/ddragon";
import { t } from "../lib/i18n";
import { useLiveGame, type LiveGame } from "../lib/live";
import { useSavedLoading } from "../lib/loading";
import { OVERLAY_STATS, useOverlaySettings, type OverlayStat } from "../lib/overlay";
import { dec1, int, pctN } from "../lib/ui";
import { LoadingCards } from "./LoadingCards";
import { Logo } from "./Logo";

// Fenêtres plein écran, transparentes, que les clics traversent : tout se place en vh / vw selon l'écran.

function useTransparentPage() {
  useEffect(() => {
    document.documentElement.classList.add("is-overlay");
    return () => document.documentElement.classList.remove("is-overlay");
  }, []);
}

/** Écran de chargement refait par Spec (données préparées par la page de l'appli). */
export function LoadingOverlay() {
  useTransparentPage();
  const data = useSavedLoading();
  const [settings] = useOverlaySettings();
  const scale = useGameScale();
  if (!data || !settings.loading) return null;
  // Le jeu dessine ses cartes dans une zone 16:9 mise à l'échelle et centrée : on pose les nôtres pile dessus.
  return (
    <div className="ov-loading" style={{ ["--s" as string]: String(scale) }}>
      <div className="ov-loading__stage"><LoadingCards data={data} full /></div>
    </div>
  );
}

/** Facteur d'échelle de l'écran de chargement du jeu (référence 2560 × 1440, centrée). */
function useGameScale(): number {
  const get = () => Math.min(window.innerWidth / 2560, window.innerHeight / 1440);
  const [s, setS] = useState(get);
  useEffect(() => {
    const on = () => setS(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

const LABEL: Record<OverlayStat, () => string> = {
  cs: () => t("CS/min"), gold: () => t("Or/min"), kp: () => t("KP"), vision: () => t("Vision/min"), kda: () => t("KDA"), goldDiff: () => t("Écart d’or"),
};

/** Valeur des objets (prix Data Dragon), sans les balises. */
function itemValue(items: number[], data: InfoMap | null): number {
  return items.reduce((a, id) => a + (data?.get(id)?.gold ?? 0), 0);
}

export function statValues(g: LiveGame, items: InfoMap | null): Record<OverlayStat, { text: string; tone?: "good" | "bad" }> {
  const min = Math.max(g.time / 60, 1);
  const s = g.scores ?? { kills: 0, deaths: 0, assists: 0, cs: 0, ward: 0 };
  const mine = itemValue(g.items, items);
  const diff = g.oppItems?.length ? mine - itemValue(g.oppItems, items) : null;
  const kp = g.teamKills ? Math.round(((s.kills + s.assists) / g.teamKills) * 100) : 0;
  const kda = s.deaths ? (s.kills + s.assists) / s.deaths : s.kills + s.assists;
  return {
    cs: { text: dec1(s.cs / min) },
    gold: { text: int(Math.round((g.gold + mine) / min)) },
    kp: { text: pctN(kp) },
    vision: { text: dec1(s.ward / min) },
    kda: { text: s.deaths ? dec1(kda) : t("Parfait") },
    goldDiff: diff == null ? { text: "—" } : { text: `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${int(Math.abs(Math.round(diff)))}`, tone: diff > 0 ? "good" : diff < 0 ? "bad" : undefined },
  };
}

/** Stats en direct, carte verticale (par défaut) ou barre horizontale, dans le coin choisi. */
export function StatsOverlay() {
  useTransparentPage();
  const [settings] = useOverlaySettings();
  const game = useLiveGame(settings.enabled);
  const items = useInfo(loadItems, localStorage.getItem("spec.ddragon") ?? "");
  if (!settings.enabled || !game) return null;
  const values = statValues(game, items);
  const shown = OVERLAY_STATS.filter((k) => settings.stats[k]);
  if (!shown.length) return null;
  return (
    <div className={`ov-stats ov-stats--${settings.layout} ov-stats--${settings.corner}`} style={{ opacity: settings.opacity / 100 }}>
      {settings.layout === "vertical"
        ? <p className="ov-stats__head"><Logo className="ov-stats__logo" />{t("Spec")}</p>
        : <Logo className="ov-stats__logo" />}
      {shown.map((k) => (
        <span key={k} className="ov-stats__item">
          <span className="ov-stats__label">{LABEL[k]()}</span>
          <strong className={values[k].tone ? `tone-${values[k].tone}` : ""}>{values[k].text}</strong>
        </span>
      ))}
    </div>
  );
}
