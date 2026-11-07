import { useState } from "react";

const POSITION_ICON = (name: string) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${name}.png`;
const POSITIONS = ["top", "jungle", "middle", "bottom", "utility"];

/** Icône officielle du poste ; si elle ne charge pas, on n'affiche rien plutôt qu'une icône fausse. */
export function RoleIcon({ role, className = "role-card__icon", title }: { role: number; className?: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`${className} ${className}--empty`} aria-hidden />;
  return <img className={className} src={POSITION_ICON(POSITIONS[role])} alt={title ?? ""} title={title} aria-hidden={title ? undefined : true}
              onError={() => setFailed(true)} />;
}
