import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Emplacement de la barre de contexte (en haut de la fenêtre) : absent en mode compact, où rien n'est affiché. */
export const TopBarSlot = createContext<HTMLElement | null>(null);

/** Barre de contexte d'un écran : son titre, puis ses filtres et son état. `<span className="grow" />` pousse la suite à droite. */
export function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const slot = useContext(TopBarSlot);
  if (!slot) return null;
  return createPortal(<><h1 className="topbar__title">{title}</h1>{children}</>, slot);
}

/** Pastille d'état de la barre de contexte. */
export function Chip({ tone, dot = false, children }: { tone?: "good" | "accent" | "bad" | "warn"; dot?: boolean; children: ReactNode }) {
  return <span className={`stag${tone ? ` stag--${tone}` : ""}`}>{dot && <span className="stag__dot" aria-hidden />}{children}</span>;
}
