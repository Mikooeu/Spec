// Taille et position de la fenêtre pour le mode compact (sans effet dans l'aperçu web).
import { IN_APP } from "./lcu";

export const COMPACT = { width: 400, height: 720, minWidth: 360, minHeight: 560 };
const FULL = { width: 1280, height: 800 };
/** Taille minimale de la grande fenêtre : tient sur un écran 1366 × 768 ou en 1080p avec une mise à l'échelle de 150 à 200 %. */
const MIN = { width: 960, height: 600 };

let previous: { width: number; height: number } | null = null;

async function win() {
  const mod = await import("@tauri-apps/api/window");
  return { w: mod.getCurrentWindow(), LogicalSize: mod.LogicalSize };
}

/** Passe la fenêtre en mode compact (petite, au premier plan) ou la remet en grand.
 *  `keepSize` : on quitte le mode compact parce que l'utilisateur a agrandi la fenêtre lui-même : on ne touche pas à sa taille. */
export async function applyCompact(on: boolean, onTop: boolean, keepSize = false): Promise<void> {
  if (!IN_APP) return;
  try {
    const { w, LogicalSize } = await win();
    if (on) {
      const scale = await w.scaleFactor();
      const size = (await w.innerSize()).toLogical(scale);
      if (size.width > COMPACT.width + 200) previous = { width: size.width, height: size.height };
      await w.setMinSize(new LogicalSize(COMPACT.minWidth, COMPACT.minHeight));
      await w.setSize(new LogicalSize(COMPACT.width, COMPACT.height));
      await w.setAlwaysOnTop(onTop);
    } else if (keepSize) {
      await w.setAlwaysOnTop(false);
      previous = null;
    } else {
      await w.setAlwaysOnTop(false);
      const back = previous ?? FULL;
      await w.setSize(new LogicalSize(back.width, back.height));
      await w.setMinSize(new LogicalSize(MIN.width, MIN.height));
      await fit(w, LogicalSize);
      await w.center();
    }
  } catch {
    /* permission manquante ou fenêtre indisponible : l'interface s'adapte quand même */
  }
}

export async function setOnTop(on: boolean): Promise<void> {
  if (!IN_APP) return;
  try {
    const { w } = await win();
    await w.setAlwaysOnTop(on);
  } catch { /* ignoré */ }
}

/** Largeur (logique) au-delà de laquelle une fenêtre compacte agrandie repasse en affichage complet. */
const EXPAND_WIDTH = 760;

/** Appelle `onExpand` si l'utilisateur agrandit la fenêtre compacte (bouton Agrandir de Windows ou bord tiré). */
export async function watchCompactExpand(onExpand: () => void): Promise<() => void> {
  if (!IN_APP) return () => undefined;
  try {
    const { w } = await win();
    const since = Date.now();   // le passage en compact redimensionne lui-même la fenêtre : on l'ignore
    return await w.onResized(async ({ payload }) => {
      if (Date.now() - since < 1500) return;
      const scale = await w.scaleFactor();
      if (payload.width / scale > EXPAND_WIDTH || (await w.isMaximized())) onExpand();
    });
  } catch {
    return () => undefined;
  }
}

type Win = Awaited<ReturnType<typeof win>>;

/** Réduit la fenêtre si elle dépasse l'écran (petits écrans, mise à l'échelle Windows élevée). */
async function fit(w: Win["w"], LogicalSize: Win["LogicalSize"]): Promise<boolean> {
  const scale = await w.scaleFactor();
  const size = (await w.innerSize()).toLogical(scale);
  const aw = Math.max(MIN.width, window.screen.availWidth - 16), ah = Math.max(MIN.height, window.screen.availHeight - 40);
  if (size.width <= aw && size.height <= ah) return false;
  await w.setSize(new LogicalSize(Math.min(size.width, aw), Math.min(size.height, ah)));
  return true;
}

// ---------- mode compact collé au client LoL ----------

/** Dernière place donnée à la fenêtre compacte (pixels physiques), pour savoir si le joueur l'a déplacée lui-même. */
let docked: { x: number; y: number } | null = null;

/** Oublie la dernière place collée (nouvelle draft, sortie du mode compact). */
export function resetDock(): void { docked = null; }

/** Colle la fenêtre compacte contre le bord droit du client LoL (ou le gauche s'il n'y a pas de place), à la même hauteur.
 *  « moved » : le joueur a déplacé la fenêtre lui-même, on arrête de la coller jusqu'à la prochaine draft.
 *  « none » : client introuvable ou réduit, rien n'a bougé. */
export async function dockToClient(): Promise<"ok" | "moved" | "none"> {
  if (!IN_APP) return "none";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const rect = await invoke<[number, number, number, number] | null>("client_window");
    if (!rect) return "none";
    const [cx, cy, cw, ch] = rect;
    const mod = await import("@tauri-apps/api/window");
    const w = mod.getCurrentWindow();
    const pos = await w.outerPosition();
    if (docked && (Math.abs(pos.x - docked.x) > 8 || Math.abs(pos.y - docked.y) > 8)) return "moved";
    const scale = await w.scaleFactor();
    const outer = await w.outerSize(), inner = await w.innerSize();
    const width = Math.round(COMPACT.width * scale) + (outer.width - inner.width);
    // écran qui contient le centre du client : on ne sort pas de cet écran
    const mons = await mod.availableMonitors();
    const mx = cx + cw / 2, my = cy + ch / 2;
    const mon = mons.find((m) => mx >= m.position.x && mx < m.position.x + m.size.width && my >= m.position.y && my < m.position.y + m.size.height) ?? mons[0];
    const left = mon ? mon.position.x : -Infinity, right = mon ? mon.position.x + mon.size.width : Infinity;
    let x = cx + cw;
    if (x + width > right) x = cx - width >= left ? cx - width : right - width;   // pas de place : à gauche, sinon par-dessus le bord du client
    if (pos.x !== x || pos.y !== cy || outer.height !== ch || outer.width !== width) {
      await w.setSize(new mod.PhysicalSize(width - (outer.width - inner.width), ch - (outer.height - inner.height)));
      await w.setPosition(new mod.PhysicalPosition(x, cy));
    }
    docked = { x, y: cy };
    return "ok";
  } catch {
    return "none";
  }
}

// ---------- raccourci global : afficher ou cacher Spec ----------

let raisedByShortcut = false;
/** Pendant qu'on choisit un nouveau raccourci dans Réglages, l'ancien ne doit pas ranger la fenêtre. */
let shortcutPaused = false;
export function pauseShortcut(on: boolean): void { shortcutPaused = on; }
/** Dernière erreur d'enregistrement du raccourci (déjà pris par une autre appli), affichée dans Réglages. */
let shortcutError: string | null = null;
export const getShortcutError = () => shortcutError;

/** Raccourci appuyé : Spec passe devant (même par-dessus le jeu en fenêtré sans bordure) ; deuxième appui : il se range.
 *  `keepOnTop` : la fenêtre est déjà au premier plan (mode compact), on lui rend cet état en la rangeant. */
export async function toggleFromShortcut(keepOnTop: boolean): Promise<void> {
  if (!IN_APP) return;
  try {
    const w = (await import("@tauri-apps/api/window")).getCurrentWindow();
    const shown = (await w.isVisible()) && !(await w.isMinimized());
    if (shown && (raisedByShortcut || (await w.isFocused()))) {
      if (raisedByShortcut) await w.setAlwaysOnTop(keepOnTop);
      raisedByShortcut = false;
      await w.minimize();
      return;
    }
    await w.unminimize();
    await w.show();
    if (!keepOnTop) { await w.setAlwaysOnTop(true); raisedByShortcut = true; }
    await w.setFocus();
  } catch { /* permission manquante : rien à faire */ }
}

/** Enregistre le raccourci global. Renvoie la fonction pour le retirer, ou une erreur lisible s'il est déjà pris. */
export async function registerShortcut(accel: string, onPress: () => void): Promise<{ stop: () => void; error: string | null }> {
  if (!IN_APP || !accel) return { stop: () => undefined, error: null };
  try {
    const gs = await import("@tauri-apps/plugin-global-shortcut");
    await gs.register(accel, (e) => { if (e.state === "Pressed" && !shortcutPaused) onPress(); });
    shortcutError = null;
    window.dispatchEvent(new Event("spec-shortcut"));
    return { stop: () => { gs.unregister(accel).catch(() => undefined); }, error: null };
  } catch (e) {
    shortcutError = String(e);
    window.dispatchEvent(new Event("spec-shortcut"));
    return { stop: () => undefined, error: shortcutError };
  }
}

/** Fait clignoter Spec dans la barre des tâches jusqu'à ce que la fenêtre soit ouverte (début de la sélection). */
export async function requestAttention(): Promise<void> {
  if (!IN_APP) return;
  try {
    const mod = await import("@tauri-apps/api/window");
    await mod.getCurrentWindow().requestUserAttention(mod.UserAttentionType.Critical);
  } catch { /* ignoré */ }
}

/** Remet la fenêtre principale devant (bouton « Agrandir » d'une fenêtre d'appoint). */
export async function showMainWindow(): Promise<void> {
  if (!IN_APP) return;
  try {
    const w = (await import("@tauri-apps/api/window")).getCurrentWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
  } catch { /* ignoré */ }
}

/** En partie : ouvre le menu de build seul par-dessus le jeu, ou le cache s'il est déjà affiché (bascule faite côté Rust, sans course). */
export async function toggleBuildWindow(): Promise<void> {
  if (!IN_APP) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const shown = await invoke<boolean>("overlay_toggle", { kind: "build" });
    // la fenêtre ne prend jamais le focus : on la prévient qu'elle vient d'être affichée (message « Rappuie sur… »)
    if (shown) (await import("@tauri-apps/api/event")).emit("spec:build-shown");
  } catch (e) { console.warn("[Spec] menu de build", e); }
}
