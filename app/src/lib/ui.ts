import { useEffect, useState } from "react";
import type { Stats } from "./score";

export const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
export const pts = (x: number) =>
  `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1).replace(".", ",")} pt`;
export const int = (x: number) => Math.round(x).toLocaleString("fr-FR");

/** Couleur d'un winrate : vert dès 51,5 %, rouge sous 49 %. */
export const wrTone = (x: number) => (x >= 0.515 ? "good" : x < 0.49 ? "bad" : "neutral");

/** Flèche qui double la couleur (lisible sans distinguer le vert du rouge) : ▲ bon, ▼ mauvais, rien sinon. */
export const toneArrow = (tone: string | undefined) => (tone === "good" ? "▲" : tone === "bad" ? "▼" : "");

export const iconUrl = (stats: Stats, champ: number) => {
  const c = stats.champions.get(champ);
  return c ? `https://ddragon.leagueoflegends.com/cdn/${stats.ddragon}/img/champion/${c.key}.png` : "";
};

export const champName = (stats: Stats, champ: number | null) =>
  champ == null ? "" : stats.champions.get(champ)?.name ?? `#${champ}`;

export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Mise à l'échelle : taille de référence 1920 px, facteur borné entre 1 et 1,5 (cf. spec). */
export function useUiScale() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      const scale = Math.min(Math.max(w / 1920, 1), 1.5);
      document.documentElement.style.fontSize = `${16 * scale}px`;
      setWide(w / scale >= 1600);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return wide;
}

/** État persistant dans le stockage local de l'appli (pool par rôle, etc.). */
const PERSIST_EVENT = "spec-persist";

/** Valeur gardée entre deux lancements ; tous les écrans qui lisent la même clé restent synchronisés. */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: T }>).detail;
      if (d?.key === key) setValue(d.value);
    };
    window.addEventListener(PERSIST_EVENT, on);
    return () => window.removeEventListener(PERSIST_EVENT, on);
  }, [key]);
  const save = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* stockage indisponible : on garde la valeur en mémoire */
    }
    window.dispatchEvent(new CustomEvent(PERSIST_EVENT, { detail: { key, value: v } }));
  };
  return [value, save];
}

/**
 * Numéro de patch public. Les données Riot gardent l'ancienne numérotation
 * (16.21 en 2026) alors que les notes de patch disent 26.21 : on ajoute 10.
 */
export function patchLabel(internal: string | number | undefined): string {
  const s = String(internal ?? "");
  const m = /^(\d+)\.(\d+)/.exec(s);
  if (!m) return s;
  const major = Number(m[1]);
  return `${major >= 15 && major < 25 ? major + 10 : major}.${m[2]}`;
}
