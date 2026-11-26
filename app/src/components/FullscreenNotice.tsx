// Le jeu est réglé en Plein écran : aucune fenêtre ne peut passer par-dessus, donc le menu de build
// ne s'afficherait pas en partie. On prévient pendant la draft et on propose de passer en Sans bordure (sur clic).

import { t } from "../lib/i18n";

/** full : jeu en Plein écran · switching : changement en cours · done : passé en Sans bordure · error : refusé par le client */
export type FullscreenState = "full" | "switching" | "done" | "error" | null;

export function FullscreenNotice({ state, onSwitch, onDismiss, compact = false }:
  { state: FullscreenState; onSwitch: () => void; onDismiss?: () => void; compact?: boolean }) {
  if (!state) return null;
  const ok = state === "done", err = state === "error";
  return (
    <div className={`fsn${ok ? " fsn--ok" : ""}${compact ? " fsn--compact" : ""}`} role={err ? "alert" : "status"}>
      <div className="fsn__line">
        <span className="fsn__icon" aria-hidden>{ok ? "✓" : "!"}</span>
        <span className="fsn__text">
          <strong>{ok ? t("Passé en Sans bordure") : err ? t("Le réglage n’a pas pu être changé") : t("Ton jeu est en Plein écran")}</strong>
          <small>{ok ? t("Le menu de build s’affichera en partie. Tu peux revenir en Plein écran dans les options du jeu.")
            : err ? t("Dans le jeu : Échap › Vidéo › Mode d’affichage › Sans bordure.")
            : compact ? t("Le build ne s’affichera pas en partie.") : t("Le menu de build ne pourra pas s’afficher par-dessus la partie.")}</small>
        </span>
        {!compact && !ok && <SwitchButton state={state} onSwitch={onSwitch} />}
        {!compact && onDismiss && <button className="fsn__close" onClick={onDismiss} aria-label={t("Fermer")}>×</button>}
      </div>
      {compact && !ok && <SwitchButton state={state} onSwitch={onSwitch} compact />}
    </div>
  );
}

function SwitchButton({ state, onSwitch, compact = false }: { state: FullscreenState; onSwitch: () => void; compact?: boolean }) {
  return (
    <button className={`btn ${compact ? "btn--secondary" : "btn--primary"} fsn__btn`} onClick={onSwitch} disabled={state === "switching"}>
      {state === "switching" ? t("Changement…") : state === "error" ? t("Réessayer") : t("Passer en Sans bordure")}
    </button>
  );
}
