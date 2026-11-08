import { useEffect, useState } from "react";
import type { Stats } from "../lib/score";
import { champName, iconUrl, loadingUrl, tileUrl } from "../lib/ui";

interface Props {
  stats: Stats;
  champ: number | null;
  size?: number; // en rem
  tone?: "default" | "accent" | "empty";
}

/** Hauteur (rem) à partir de laquelle l'icône devient une mini-carte ; en dessous, le visage reste plus lisible en carré. */
const CARD_FROM = 2.5;

/**
 * Icône du champion. À partir de 2,5 rem : mini-carte (vignette du splash art Data Dragon, centrée sur le visage),
 * avec le portrait de chargement puis l'icône carrée en secours. En dessous : icône carrée aux coins arrondis.
 */
export function ChampionIcon({ stats, champ, size = 2.5, tone = "default" }: Props) {
  const card = size >= CARD_FROM;
  // mini-carte : vignette centrée sur le visage, puis portrait de chargement, puis icône carrée ; sinon rien
  const chain = card ? ["tile", "loading", "icon"] as const : ["icon"] as const;
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [champ]);   // nouveau champion : on repart de la vignette
  const style = { width: `${(card ? size * 0.74 : size).toFixed(3)}rem`, height: `${size}rem`,
                  borderRadius: `${Math.max(0.25, size * (card ? 0.16 : 0.22)).toFixed(3)}rem` };
  if (champ == null || step >= chain.length) {
    return <span className={`icon icon--${champ == null ? (tone === "accent" ? "accent" : "empty") : "default"}`}
                 style={style} aria-hidden />;
  }
  const kind = chain[step];
  const src = kind === "tile" ? tileUrl(stats, champ) : kind === "loading" ? loadingUrl(stats, champ) : iconUrl(stats, champ);
  return (
    <span className={`icon icon--image icon--${kind}`} style={style}>
      <img key={src} src={src} alt={champName(stats, champ)} loading="lazy" draggable={false}
           onError={() => setStep(step + 1)} />
    </span>
  );
}
