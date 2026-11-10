import { adaptationsFor } from "../lib/adapt";
import type { Situation } from "../lib/composition";
import { loadItems, useInfo } from "../lib/ddragon";
import { t } from "../lib/i18n";
import type { Stats } from "../lib/score";
import { pctN } from "../lib/ui";
import { ItemIcon } from "./ChampionScreen";
import { Rune, useRuneData } from "./Runes";

const LABEL: Record<Situation, () => string> = {
  ap: () => t("Beaucoup de dégâts magiques en face"),
  ad: () => t("Beaucoup de dégâts physiques en face"),
  tank: () => t("Plusieurs tanks en face"),
  heal: () => t("Plusieurs soigneurs en face"),
};

/** « Face à leur équipe » : objets et runes que les joueurs Master+ prennent nettement plus souvent dans cette situation. */
export function Adaptations({ stats, champ, role, enemies }: { stats: Stats; champ: number; role: number; enemies: number[] }) {
  const items = useInfo(loadItems, stats.ddragon);
  const runes = useRuneData(stats.ddragon);
  const list = adaptationsFor(stats, champ, role, enemies).slice(0, 2);
  if (!list.length) return null;
  const why = (rin: number, rout: number) => t("Pris dans {a} des parties dans cette situation, {b} sinon", { a: pctN(Math.round(rin * 100)), b: pctN(Math.round(rout * 100)) });
  return (
    <div className="adapt">
      <p className="overline">{t("Face à leur équipe")}</p>
      {list.map((a) => (
        <div key={a.situation} className="adapt__row">
          <span className="adapt__label">{LABEL[a.situation]()}</span>
          <span className="adapt__picks">
            {a.items.map(([id, rin, rout]) => (
              <span key={`i${id}`} className="adapt__pick" title={why(rin, rout)}>
                <ItemIcon id={id} data={items} size="sm" />
                <small>{pctN(Math.round(rin * 100))}</small>
              </span>
            ))}
            {a.runes.map(([id, rin, rout]) => (
              <span key={`r${id}`} className="adapt__pick" title={why(rin, rout)}>
                <Rune data={runes} id={id} size="minor" />
                <small>{pctN(Math.round(rin * 100))}</small>
              </span>
            ))}
          </span>
        </div>
      ))}
      <p className="muted small">{t("Ce que les joueurs Master+ adaptent face à ce type d’équipe. Le pourcentage : part des parties où ils le prennent.")}</p>
    </div>
  );
}
