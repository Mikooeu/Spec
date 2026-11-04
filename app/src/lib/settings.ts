// Réglages de Spec : préférences gardées sur ce PC, lancement au démarrage de Windows, dossier d'installation.
import { invoke } from "@tauri-apps/api/core";
import { IN_APP } from "./lcu";
import { usePersistent } from "./ui";
import type { Region } from "./api";

export type Lang = "fr" | "en";
/** Rôles choisis à l'accueil : principal puis secondaire (index dans ROLES). */
export interface Roles { main: number | null; second: number | null }

export const useLang = () => usePersistent<Lang>("spec.lang", "fr");
export const useDefaultRegion = () => usePersistent<Region>("spec.region.default", "euw");
export const useRoles = () => usePersistent<Roles>("spec.roles", { main: null, second: null });
export const useOnboarded = () => usePersistent<boolean>("spec.onboarded", false);

/** Lancement au démarrage de Windows (fenêtre réduite dans la barre des tâches). null : inconnu ou hors appli. */
export async function autostartEnabled(): Promise<boolean | null> {
  if (!IN_APP) return null;
  try { const { isEnabled } = await import("@tauri-apps/plugin-autostart"); return await isEnabled(); } catch { return null; }
}
export async function setAutostart(on: boolean): Promise<string | null> {
  if (!IN_APP) return "Disponible dans l’appli installée.";
  try {
    const m = await import("@tauri-apps/plugin-autostart");
    if (on) await m.enable(); else await m.disable();
    return null;
  } catch {
    return "Windows a refusé le changement. Réessaie, ou lance Spec en administrateur une fois.";
  }
}

/** Chemin de Spec.exe sur ce PC (null hors appli). */
export async function installPath(): Promise<string | null> {
  if (!IN_APP) return null;
  try { return await invoke<string>("install_path"); } catch { return null; }
}
export async function revealInstall(path: string): Promise<void> {
  try { const { revealItemInDir } = await import("@tauri-apps/plugin-opener"); await revealItemInDir(path); } catch { /* explorateur indisponible */ }
}
export async function appVersion(): Promise<string | null> {
  if (!IN_APP) return null;
  try { const { getVersion } = await import("@tauri-apps/api/app"); return await getVersion(); } catch { return null; }
}
