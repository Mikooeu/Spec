import { useEffect, useState } from "react";
import { CDN } from "./ddragon";

/** Icônes d'invocateur gardées en data URL : affichage immédiat au lancement suivant,
 *  au lieu d'attendre Data Dragon à chaque ouverture du profil. */
const KEY = "spec.icons";
const MAX = 16;

type Store = Record<string, { src: string; at: number }>;
const mem = new Map<number, string>();
const pending = new Map<number, Promise<string | null>>();

function read(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Store; } catch { return {}; }
}
function write(s: Store) {
  const kept = Object.entries(s).sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* quota : tant pis, on garde la mémoire */ }
}

export const iconUrl = (version: string, icon: number) => `${CDN}/${version}/img/profileicon/${icon}.png`;

export function cachedIcon(icon: number): string | null {
  const m = mem.get(icon);
  if (m) return m;
  const s = read()[icon];
  if (s) { mem.set(icon, s.src); return s.src; }
  return null;
}

/** Télécharge l'icône une seule fois et la garde (mémoire + stockage local). */
export function preloadIcon(version: string, icon: number): Promise<string | null> {
  const hit = cachedIcon(icon);
  if (hit) return Promise.resolve(hit);
  const p = pending.get(icon);
  if (p) return p;
  const job = fetch(iconUrl(version, icon))
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((b) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); }))
    .then((src) => { mem.set(icon, src); const s = read(); s[icon] = { src, at: Date.now() }; write(s); return src; })
    .catch(() => null)
    .finally(() => pending.delete(icon));
  pending.set(icon, job);
  return job;
}

/** Source à afficher : la copie locale si on l'a, sinon l'URL Data Dragon (et on la garde pour la prochaine fois). */
export function useIconSrc(version: string | null | undefined, icon: number | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => (icon != null ? cachedIcon(icon) : null));
  useEffect(() => {
    if (icon == null) { setSrc(null); return; }
    const hit = cachedIcon(icon);
    if (hit) { setSrc(hit); return; }
    if (!version) { setSrc(null); return; }
    setSrc(iconUrl(version, icon));
    let alive = true;
    preloadIcon(version, icon).then((s) => { if (alive && s) setSrc(s); });
    return () => { alive = false; };
  }, [version, icon]);
  return src;
}
