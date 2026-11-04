import { toneArrow } from "../lib/ui";

/** Flèche ▲ / ▼ à côté d'une valeur colorée : l'info ne passe pas que par la couleur. */
export function Trend({ tone }: { tone?: string }) {
  const a = toneArrow(tone);
  if (!a) return null;
  return <span className={`trend tone-${tone}`} aria-label={tone === "good" ? "favorable" : "défavorable"}>{a}</span>;
}
