// Taille et position de la fenêtre pour le mode compact (sans effet dans l'aperçu web).
import { IN_APP } from "./lcu";

export const COMPACT = { width: 400, height: 720, minWidth: 360, minHeight: 560 };
const FULL = { width: 1280, height: 800 };

let previous: { width: number; height: number } | null = null;

async function win() {
  const mod = await import("@tauri-apps/api/window");
  return { w: mod.getCurrentWindow(), LogicalSize: mod.LogicalSize };
}

/** Passe la fenêtre en mode compact (petite, au premier plan) ou la remet en grand. */
export async function applyCompact(on: boolean, onTop: boolean): Promise<void> {
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
    } else {
      await w.setAlwaysOnTop(false);
      const back = previous ?? FULL;
      await w.setSize(new LogicalSize(back.width, back.height));
      await w.setMinSize(new LogicalSize(FULL.width, FULL.height));
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
