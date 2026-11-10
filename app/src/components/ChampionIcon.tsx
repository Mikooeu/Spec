import { useEffect, useState } from "react";
import type { Stats } from "../lib/score";
import { champName, freshLoadingUrl, freshTileUrl, iconUrl, loadingUrl, tileUrl } from "../lib/ui";

interface Props {
  stats: Stats;
  champ: number | null;
  size?: number; // en rem
  tone?: "default" | "accent" | "empty";
  /** Icône ronde (puces du champion pool) au lieu du carré arrondi. */
  round?: boolean;
}

/** Hauteur (rem) à partir de laquelle l'icône devient une mini-carte ; en dessous, le visage reste plus lisible en carré. */
const CARD_FROM = 2.5;

/**
 * Icône du champion. À partir de 2,5 rem : mini-carte (vignette du splash art Data Dragon, centrée sur le visage),
 * avec le portrait de chargement puis l'icône carrée en secours. En dessous : icône carrée aux coins arrondis.
 */
export function ChampionIcon({ stats, champ, size = 2.5, tone = "default", round = false }: Props) {
  const card = size >= CARD_FROM && !round;
  // mini-carte : vignette centrée sur le visage, puis portrait de chargement, puis icône carrée ; sinon rien
  const chain = card ? ["freshTile", "tile", "freshLoading", "loading", "icon"] as const : ["icon"] as const;
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [champ]);   // nouveau champion : on repart de la vignette
  const style = { width: `${(card ? size * 0.74 : size).toFixed(3)}rem`, height: `${size}rem`,
                  borderRadius: round ? "50%" : `${Math.max(0.25, size * (card ? 0.16 : 0.22)).toFixed(3)}rem` };
  if (champ == null || step >= chain.length) {
    return <span className={`icon icon--${champ == null ? (tone === "accent" ? "accent" : "empty") : "default"}`}
                 style={style} aria-hidden />;
  }
  const kind = chain[step];
  const url = { freshTile: freshTileUrl, tile: tileUrl, freshLoading: freshLoadingUrl, loading: loadingUrl, icon: iconUrl }[kind];
  const src = url(stats, champ);
  return (
    <span className={`icon icon--image icon--${kind.replace("fresh", "").toLowerCase()}`} style={style}>
      <img key={src} src={src} alt={champName(stats, champ)} loading="lazy" draggable={false}
           onError={() => setStep(step + 1)} />
    </span>
  );
}
