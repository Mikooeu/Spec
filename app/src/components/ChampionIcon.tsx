import { useState } from "react";
import type { Stats } from "../lib/score";
import { champName, iconUrl } from "../lib/ui";

interface Props {
  stats: Stats;
  champ: number | null;
  size?: number; // en rem
  tone?: "default" | "accent" | "empty";
}

/** Icône officielle du champion, chargée depuis Data Dragon (CDN de Riot). */
export function ChampionIcon({ stats, champ, size = 2.5, tone = "default" }: Props) {
  const [failed, setFailed] = useState(false);
  const style = { width: `${size}rem`, height: `${size}rem` };
  if (champ == null || failed) {
    return <span className={`icon icon--${champ == null ? (tone === "accent" ? "accent" : "empty") : "default"}`}
                 style={style} aria-hidden />;
  }
  return (
    <span className="icon icon--image" style={style}>
      <img src={iconUrl(stats, champ)} alt={champName(stats, champ)} loading="lazy" draggable={false}
           onError={() => setFailed(true)} />
    </span>
  );
}
