import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";

/** Une étape de la visite : l'élément à mettre en valeur (attribut data-tour) et sa bulle. Sans cible : carte centrée. */
export interface TourStep { target?: string; title: string; text: string }

interface Props {
  steps: TourStep[];
  onClose: () => void;
  /** Dernière étape : lance la draft d'essai. */
  onDemo?: () => void;
}

const PAD = 6;
const BUBBLE_W = 320;

/** Visite guidée : voile sombre, élément entouré en bleu, bulle avec Passer / Retour / Suivant. Échap ferme, ← → naviguent. */
export function Tour({ steps, onClose, onDemo }: Props) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [, setTick] = useState(0);
  const primary = useRef<HTMLButtonElement>(null);
  const step = steps[i], last = i === steps.length - 1;

  // position de la cible, recalculée au redimensionnement
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      setBox(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const onResize = () => { measure(); setTick((n) => n + 1); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [step.target]);

  useEffect(() => { primary.current?.focus(); }, [i]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1);
      else if (e.key === "Tab") { e.preventDefault(); primary.current?.focus(); }   // le focus reste dans la bulle
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i, last, onClose]);

  const W = window.innerWidth, H = window.innerHeight;
  const hole = box ? { x: box.left - PAD, y: box.top - PAD, w: box.width + PAD * 2, h: box.height + PAD * 2 } : null;
  // bulle à droite de la cible, ramenée dans l'écran
  const bubble = hole
    ? { left: Math.min(hole.x + hole.w + 16, W - BUBBLE_W - 16), top: Math.max(16, Math.min(hole.y - 8, H - 220)) }
    : null;

  const next = () => (last ? onClose() : setI(i + 1));
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      {hole ? (
        <>
          <div className="tour__veil" style={{ left: 0, top: 0, width: W, height: Math.max(0, hole.y) }} />
          <div className="tour__veil" style={{ left: 0, top: hole.y + hole.h, width: W, height: Math.max(0, H - hole.y - hole.h) }} />
          <div className="tour__veil" style={{ left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h }} />
          <div className="tour__veil" style={{ left: hole.x + hole.w, top: hole.y, width: Math.max(0, W - hole.x - hole.w), height: hole.h }} />
          <div className="tour__ring" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />
        </>
      ) : <div className="tour__veil" style={{ inset: 0 }} />}

      <div className={`tour__bubble${hole ? "" : " is-center"}`} style={bubble ?? undefined}>
        <small className="tour__count">{t("{n} / {total}", { n: i + 1, total: steps.length })}</small>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        {last && onDemo ? (
          <>
            <div className="tour__actions tour__actions--center">
              <button className="btn btn--secondary" onClick={onClose}>{t("Plus tard")}</button>
              <button ref={primary} className="btn btn--primary" onClick={() => { onClose(); onDemo(); }}>{t("Lancer une draft d’essai")}</button>
            </div>
            <small className="tour__hint">{t("Tu peux revoir la visite dans Réglages.")}</small>
          </>
        ) : (
          <div className="tour__actions">
            <button className="link-btn tour__skip" onClick={onClose}>{t("Passer")}</button>
            <span className="grow" />
            {i > 0 && <button className="btn btn--secondary btn--small" onClick={() => setI(i - 1)}>{t("Retour")}</button>}
            <button ref={primary} className="btn btn--primary btn--small" onClick={next}>{last ? t("Terminer") : t("Suivant")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Les 5 étapes de « Bienvenue sur Spec ». */
export function specTour(): TourStep[] {
  return [
    { target: "draft", title: t("Ta draft"), text: t("Dès que la sélection des champions commence, Spec affiche ici tes meilleurs picks pour la draft en cours. Le reste du temps, c’est ton accueil.") },
    { target: "compact", title: t("Le mode compact"), text: t("Une petite fenêtre au premier plan, à côté du client LoL. Idéal pendant la draft sur un seul écran.") },
    { target: "overlay", title: t("L’overlay en partie"), text: t("Tes stats et celles de ton vis-à-vis par-dessus le jeu. Tu choisis quoi afficher et où le placer sur ton écran.") },
    { target: "profile", title: t("Ton profil"), text: t("Ton historique, le récap de chaque partie et la courbe de tes LP. Tu peux aussi chercher un autre joueur.") },
    { title: t("Tu es prêt"), text: t("Essaie une draft de démo pour voir les recommandations en action, sans lancer de partie.") },
  ];
}
