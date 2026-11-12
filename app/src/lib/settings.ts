// Réglages de Spec : préférences gardées sur ce PC, lancement au démarrage de Windows, dossier d'installation.
import { invoke } from "@tauri-apps/api/core";
import { IN_APP } from "./lcu";
import { usePersistent } from "./ui";
import type { Region } from "./api";
import { t, setLang as applyLang, type Lang } from "./i18n";

export type { Lang };

/** Rôles choisis à l'accueil : principal puis secondaire (index dans ROLES). */
export interface Roles { main: number | null; second: number | null }

/** Langue de l'interface : la changer recharge l'appli (tous les textes, même les listes fixes, sont retraduits). */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, save] = usePersistent<Lang>("spec.lang", "fr");
  return [lang, (l: Lang) => { if (l === lang) return; applyLang(l); save(l); window.location.reload(); }];
}
export const useDefaultRegion = () => usePersistent<Region>("spec.region.default", "euw");
export const useRoles = () => usePersistent<Roles>("spec.roles", { main: null, second: null });
export const useOnboarded = () => usePersistent<boolean>("spec.onboarded", false);
/** Au début de la sélection des champions, si Spec n'est pas au premier plan : clignote dans la barre des tâches. */
export const useSelectAlert = () => usePersistent<boolean>("spec.alert.select", true);

/** Lancement au démarrage de Windows (fenêtre réduite dans la barre des tâches). null : inconnu ou hors appli. */
export async function autostartEnabled(): Promise<boolean | null> {
  if (!IN_APP) return null;
  try { const { isEnabled } = await import("@tauri-apps/plugin-autostart"); return await isEnabled(); } catch { return null; }
}
export async function setAutostart(on: boolean): Promise<string | null> {
  if (!IN_APP) return t("Disponible dans l’appli installée.");
  try {
    const m = await import("@tauri-apps/plugin-autostart");
    if (on) await m.enable(); else await m.disable();
    return null;
  } catch {
    return t("Windows a refusé le changement. Réessaie, ou lance Spec en administrateur une fois.");
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
