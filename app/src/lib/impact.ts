// « Spec t'aide-t-il à gagner ? » : au lock, Spec note la place de ton champion dans ses recos ;
// après la partie, on la relie au résultat. Tout reste sur ce PC (stockage local de l'appli).
import type { Game } from "./history";

const PENDING = "spec.impact.pending";
const DONE = "spec.impact.games";
const MAX_AGE = 30 * 86400_000;

/** Pick verrouillé avec Spec ouvert : `rank` = place dans les recos (1 = conseillé en premier), null si absent. */
export interface LockedPick { at: number; champ: number; role: number; rank: number | null; top?: number[] }
interface Settled { followed: boolean; win: boolean; at: number; champ?: number; rank?: number | null; top?: number[] }

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
};
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* stockage plein */ } };

/** À appeler au lock ; un même pick n'est noté qu'une fois par draft. */
export function recordPick(p: LockedPick) {
  const list = read<LockedPick[]>(PENDING, []).filter((x) => p.at - x.at < MAX_AGE);
  if (list.some((x) => x.champ === p.champ && p.at - x.at < 15 * 60_000)) return;
  write(PENDING, [...list, p].slice(-50));
}

/** Relie les picks notés aux parties de l'historique (même champion, partie lancée juste après le lock). */
export function settle(games: Game[]): boolean {
  const pending = read<LockedPick[]>(PENDING, []);
  if (!pending.length) return false;
  const done = read<Record<string, Settled>>(DONE, {});
  const left: LockedPick[] = [];
  let changed = false;
  for (const p of pending) {
    const g = games.find((x) => x.champ === p.champ && !x.remake && x.queue !== "other"
      && x.created >= p.at - 15 * 60_000 && x.created <= p.at + 60 * 60_000 && !done[String(x.id)]);
    if (g) { done[String(g.id)] = { followed: p.rank === 1, win: g.win, at: p.at, champ: p.champ, rank: p.rank, top: p.top }; changed = true; }
    else if (Date.now() - p.at < 2 * 86400_000) left.push(p);      // la partie peut encore arriver
  }
  write(PENDING, left);
  if (changed) write(DONE, done);
  return changed;
}

export interface Impact { total: number; followed: [number, number]; other: [number, number] }

/** Bilan : [parties, victoires] en jouant le n°1 de Spec, et en jouant autre chose. */
export function impact(): Impact {
  const done = Object.values(read<Record<string, Settled>>(DONE, {}));
  const followed: [number, number] = [0, 0], other: [number, number] = [0, 0];
  for (const d of done) {
    const t = d.followed ? followed : other;
    t[0] += 1; t[1] += d.win ? 1 : 0;
  }
  return { total: done.length, followed, other };
}

export const IMPACT_MIN = 20;       // en dessous : barre de progression, pas de pourcentage
export const IMPACT_RELIABLE = 100; // à partir de là : « Résultat fiable »

/** Bilan d'une partie jouée avec Spec ouvert : ce que Spec conseillait (3 premiers), ce que tu as joué, le résultat. */
export interface Recap { game: number; at: number; champ: number; rank: number | null; top: number[]; win: boolean }

/** Bilans détaillés, du plus récent au plus ancien (seulement les parties notées depuis la 0.3.7). */
export function recaps(): Recap[] {
  return Object.entries(read<Record<string, Settled>>(DONE, {}))
    .filter(([, d]) => d.champ != null && d.top?.length)
    .map(([id, d]) => ({ game: Number(id), at: d.at, champ: d.champ!, rank: d.rank ?? null, top: d.top!, win: d.win }))
    .sort((a, b) => b.at - a.at);
}
