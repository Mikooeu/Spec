import { t } from "../lib/i18n";
import { useEffect } from "react";
import { OVERLAY_STATS, closeOverlay, openOverlay, setOverlayInteractive, type Corner, type OverlaySettings, type OverlayStat } from "../lib/overlay";
import { Choice, Row, Section, Toggle } from "./SettingsScreen";

const STAT: Record<OverlayStat, [() => string, () => string]> = {
  cs: [() => t("CS par minute"), () => t("Sbires et monstres tués par minute.")],
  gold: [() => t("Or par minute"), () => t("Estimé : or en poche plus la valeur de tes objets.")],
  kp: [() => t("Participation aux kills"), () => t("Part des kills de ton équipe où tu as participé (kill ou assist).")],
  vision: [() => t("Vision par minute"), () => t("Ton score de vision divisé par la durée de la partie.")],
  kda: [() => t("KDA"), () => t("(Kills + assists) / morts.")],
  goldDiff: [() => t("Écart d’or avec ton vis-à-vis"), () => t("Estimé sur la valeur des objets de chacun : l’or en poche de l’adversaire n’est pas visible.")],
};

/** Onglet Overlay : ce que Spec affiche par-dessus le jeu. */
export function OverlayScreen({ settings: s, onChange: save, inGame }: { settings: OverlaySettings; onChange: (s: OverlaySettings) => void; inGame: boolean }) {
  // mode déplacement : l'overlay s'affiche (avec des valeurs d'exemple hors partie) et reçoit la souris
  const startEdit = async () => { save({ ...s, editing: true }); await openOverlay("overlay"); await setOverlayInteractive(true); };
  const stopEdit = async () => { save({ ...s, editing: false }); await setOverlayInteractive(false); if (!inGame) await closeOverlay("overlay"); };
  useEffect(() => () => { if (s.editing) { stopEdit(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="content settings">
      <header className="page-head"><div><h1>{t("Overlay")}</h1></div></header>

      <Section title={t("Overlay en partie")}>
        <Row label={t("Afficher l’overlay")}
             desc={t("Tes stats en direct par-dessus le jeu. Le jeu doit être en mode Sans bordure ou Fenêtré (Options › Vidéo › Mode fenêtre).")}>
          <Toggle on={s.enabled} onChange={() => save({ ...s, enabled: !s.enabled })} label={t("Afficher l’overlay")} />
        </Row>
        <Row label={t("Disposition")} desc={t("Verticale : une carte avec une ligne par stat. Horizontale : une barre plus discrète.")}>
          <Choice value={s.layout} onChange={(layout) => save({ ...s, layout })}
                  options={[["vertical", t("Verticale")], ["horizontal", t("Horizontale")]]} />
        </Row>
        <Row label={t("Position")} desc={s.pos ? t("Placé à la main. Choisis un coin pour revenir à une position fixe.") : t("Coin de l’écran où l’overlay s’affiche.")}>
          <Choice<Corner> value={s.pos ? ("" as Corner) : s.corner} onChange={(corner) => save({ ...s, corner, pos: null })}
                  options={[["tl", t("Haut gauche")], ["tr", t("Haut droite")], ["bl", t("Bas gauche")], ["br", t("Bas droite")]]} />
        </Row>
        <Row label={t("Déplacer à la souris")}
             desc={s.editing ? t("Glisse l’overlay où tu veux sur ton écran, puis clique sur Terminé sous l’overlay ou appuie sur Échap. Le jeu ne reçoit pas les clics pendant ce temps.")
                             : t("Affiche l’overlay sur ton écran pour le placer où tu veux (par exemple sous ton compteur de FPS).")}>
          <button className={`btn ${s.editing ? "btn--primary" : "btn--secondary"} btn--small`} onClick={s.editing ? stopEdit : startEdit}>
            {s.editing ? t("Terminé") : t("Déplacer")}
          </button>
        </Row>
        <Row label={t("Opacité")} desc={t("Plus discret pour ne pas gêner la lecture du jeu.")}>
          <Choice value={String(s.opacity) as "60" | "80" | "100"} onChange={(o) => save({ ...s, opacity: Number(o) as 60 | 80 | 100 })}
                  options={[["60", "60 %"], ["80", "80 %"], ["100", "100 %"]]} />
        </Row>
      </Section>

      <Section title={t("Stats affichées")}>
        {OVERLAY_STATS.map((k) => (
          <Row key={k} label={STAT[k][0]()} desc={STAT[k][1]()}>
            <Toggle on={s.stats[k]} onChange={() => save({ ...s, stats: { ...s.stats, [k]: !s.stats[k] } })} label={STAT[k][0]()} />
          </Row>
        ))}
      </Section>

      <Section title={t("Écran de chargement")}>
        <Row label={t("Écran de chargement Spec")}
             desc={t("Remplace l’écran de chargement du jeu : rang, winrate, séries, parties sur le champion et face-à-face. Disparaît dès le début de la partie.")}>
          <Toggle on={s.loading} onChange={() => save({ ...s, loading: !s.loading })} label={t("Écran de chargement Spec")} />
        </Row>
      </Section>
    </div>
  );
}
