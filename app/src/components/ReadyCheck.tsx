// Partie trouvée : bouton pour l'accepter depuis Spec (jamais automatiquement).
import { useEffect, useState } from "react";
import { acceptQueue, type ReadyCheck } from "../lib/lcu";
import { t } from "../lib/i18n";

/** Durée de la fenêtre d'acceptation dans le client (secondes). */
const READY_SECONDS = 12;

export function ReadyCheckToast({ check, compact = false }: { check: ReadyCheck | null | undefined; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!check) { setBusy(false); setError(null); } }, [check == null]);
  if (!check || check.response === "Declined") return null;
  const accepted = check.response === "Accepted";
  const left = Math.max(0, Math.ceil(READY_SECONDS - check.timer));
  const accept = async () => {
    setBusy(true);
    setError(await acceptQueue());
    setBusy(false);
  };
  return (
    <div className={`readycheck${compact ? " readycheck--compact" : ""}`} role="alertdialog" aria-live="assertive" aria-label={t("Partie trouvée")}>
      <div className="readycheck__text">
        <strong>{t("Partie trouvée")}</strong>
        <small className="muted">{error ?? (accepted ? t("Acceptée. En attente des autres joueurs.") : t("{n} s pour accepter", { n: left }))}</small>
      </div>
      {!accepted && (
        <button className="btn btn--primary" onClick={accept} disabled={busy} autoFocus>{busy ? t("Envoi…") : t("Accepter")}</button>
      )}
      {!accepted && <span className="readycheck__bar" style={{ transform: `scaleX(${left / READY_SECONDS})` }} aria-hidden />}
    </div>
  );
}
