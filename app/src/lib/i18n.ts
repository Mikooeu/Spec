// Langue de l'interface. Les textes sont écrits en français dans le code ; t() renvoie leur traduction
// anglaise (dictionnaire lib/i18n-en.ts) quand l'anglais est choisi. Un texte absent du dictionnaire
// reste en français : rien ne casse, il manque juste une traduction.
//
// Variables : t("Encore {n} parties", { n: 3 }). Changer de langue recharge l'appli : t() peut donc aussi
// servir dans les listes fixes des modules (libellés de rôles, de files…).
import { EN } from "./i18n-en";

export type Lang = "fr" | "en";
const KEY = "spec.lang";

function initial(): Lang {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '"fr"') === "en" ? "en" : "fr"; } catch { return "fr"; }
}
let current: Lang = initial();

export const getLang = (): Lang => current;
/** Appelé par le réglage de langue (lib/settings) avant que l'appli se redessine. */
export function setLang(l: Lang) { current = l; }

/** Locale des nombres et des dates, et dossier Data Dragon des noms officiels (champions, objets, sorts, runes). */
export const locale = () => (current === "en" ? "en-US" : "fr-FR");
export const ddragonLocale = () => (current === "en" ? "en_US" : "fr_FR");

const missing = new Set<string>();

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = fr;
  if (current === "en") {
    const en = EN[fr];
    if (en != null) s = en;
    else if (import.meta.env.DEV && !missing.has(fr)) { missing.add(fr); console.warn("[i18n] sans traduction :", fr); }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Pluriel simple : plural(n, "partie", "parties") (français et anglais n'ont que deux formes ici). */
export const plural = (n: number, one: string, many: string) => t(Math.abs(n) >= 2 ? many : one, { n });

/** Rang ordinal : « 1er », « 2e » en français ; « 1st », « 2nd », « 3rd », « 4th » en anglais. */
export function ordinal(n: number): string {
  if (current !== "en") return n === 1 ? "1er" : `${n}e`;
  const r10 = n % 10, r100 = n % 100;
  return `${n}${r10 === 1 && r100 !== 11 ? "st" : r10 === 2 && r100 !== 12 ? "nd" : r10 === 3 && r100 !== 13 ? "rd" : "th"}`;
}
