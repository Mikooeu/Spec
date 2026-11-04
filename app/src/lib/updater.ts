// Mises à jour de Spec : vérifiées au lancement puis toutes les 6 h, installées seulement sur clic.
import { useCallback, useEffect, useState } from "react";
import { IN_APP } from "./lcu";

export type UpdateState =
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string; percent: number | null }
  | { kind: "error"; version: string };

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

/** Résultat d'une recherche lancée à la main (écran Réglages). */
export type CheckResult = "available" | "uptodate" | "error" | "unavailable";

export function useUpdate(): [UpdateState, () => void, () => Promise<CheckResult>] {
  const [state, setState] = useState<UpdateState>({ kind: "none" });
  const [update, setUpdate] = useState<Update>(null);

  useEffect(() => {
    if (!IN_APP || import.meta.env.DEV) return; // pas de mise à jour en mode développement
    let stopped = false;
    const look = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (!stopped && found) { setUpdate(found); setState({ kind: "available", version: found.version }); }
      } catch { /* hors ligne ou pas encore de version publiée */ }
    };
    look();
    const timer = window.setInterval(look, 6 * 3600_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  const install = useCallback(async () => {
    if (!update) return;
    const version = update.version;
    let total = 0, done = 0;
    setState({ kind: "installing", version, percent: null });
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ kind: "installing", version, percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setState({ kind: "error", version });
    }
  }, [update]);

  const checkNow = useCallback(async (): Promise<CheckResult> => {
    if (!IN_APP) return "unavailable";
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (found) { setUpdate(found); setState({ kind: "available", version: found.version }); return "available"; }
      return "uptodate";
    } catch { return "error"; }
  }, []);

  return [state, install, checkNow];
}
