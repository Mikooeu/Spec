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
