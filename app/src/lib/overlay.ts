// Fenêtres par-dessus le jeu (commandes Rust overlay_open / overlay_close) et leurs réglages.
// Les réglages vivent dans le localStorage, partagé par toutes les fenêtres de Spec : l'overlay suit
// les changements faits dans l'onglet Overlay grâce à l'évènement « storage ».

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IN_APP } from "./lcu";

export type OverlayStat = "cs" | "gold" | "kp" | "vision" | "kda" | "goldDiff";
export type Corner = "tl" | "tr" | "bl" | "br";
export interface OverlaySettings {
  enabled: boolean;
  layout: "vertical" | "horizontal";
  corner: Corner;
  opacity: 60 | 80 | 100;
  stats: Record<OverlayStat, boolean>;
  loading: boolean;          // écran de chargement refait par Spec
}

export const OVERLAY_STATS: OverlayStat[] = ["cs", "gold", "kp", "vision", "kda", "goldDiff"];
const KEY = "spec.overlay";
export const DEFAULT_OVERLAY: OverlaySettings = {
  enabled: true, layout: "vertical", corner: "tr", opacity: 80, loading: true,
  stats: { cs: true, gold: true, kp: true, vision: false, kda: true, goldDiff: true },
};

export function readOverlay(): OverlaySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return raw ? { ...DEFAULT_OVERLAY, ...raw, stats: { ...DEFAULT_OVERLAY.stats, ...raw.stats } } : DEFAULT_OVERLAY;
  } catch { return DEFAULT_OVERLAY; }
}

export function useOverlaySettings(): [OverlaySettings, (s: OverlaySettings) => void] {
  const [s, setS] = useState(readOverlay);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === KEY) setS(readOverlay()); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const save = (next: OverlaySettings) => {
    setS(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* stockage plein */ }
  };
  return [s, save];
}

export type OverlayKind = "overlay" | "loading";

export async function openOverlay(kind: OverlayKind): Promise<void> {
  if (!IN_APP) return;
  try { await invoke("overlay_open", { kind }); } catch (e) { console.warn("[overlay]", kind, e); }
}

export async function closeOverlay(kind: OverlayKind): Promise<void> {
  if (!IN_APP) return;
  try { await invoke("overlay_close", { kind }); } catch { /* déjà fermée */ }
}

/** Vue affichée par cette fenêtre : l'appli, ou l'une des fenêtres par-dessus le jeu (?view=…). */
export function currentView(): "app" | OverlayKind {
  const v = new URLSearchParams(location.search).get("view");
  return v === "overlay" || v === "loading" ? v : "app";
}
