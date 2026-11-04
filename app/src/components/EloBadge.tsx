import { useState } from "react";

// Emblème officiel Riot (servi par Community Dragon) : les stats de Spec viennent du ladder Master et au-dessus.
const CREST = "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/master.svg";

/** Niveau des parties analysées. Pas de menu : Spec ne collecte que du Master+. */
export function EloBadge() {
  const [failed, setFailed] = useState(false);
  return (
    <span className="elo-badge" title="Stats tirées des parties classées Master, Grandmaster et Challenger">
      {!failed && <img src={CREST} alt="" aria-hidden onError={() => setFailed(true)} />}
      Master +
    </span>
  );
}
