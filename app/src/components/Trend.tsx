import { toneArrow } from "../lib/ui";
import { t } from "../lib/i18n";

/** Flèche ▲ / ▼ à côté d'une valeur colorée : l'info ne passe pas que par la couleur. */
export function Trend({ tone }: { tone?: string }) {
  const a = toneArrow(tone);
  if (!a) return null;
  return <span className={`trend tone-${tone}`} aria-label={tone === "good" ? "favorable" : t("défavorable")}>{a}</span>;
}
