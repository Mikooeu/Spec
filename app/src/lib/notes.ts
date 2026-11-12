// Notes de matchup : une note courte par « ton champion, dans ce rôle, contre son vis-à-vis », gardée sur le PC.
import { usePersistent } from "./ui";

export const NOTE_MAX = 280;

export const noteKey = (champ: number, role: number, enemy: number) => `${champ}:${role}:${enemy}`;
/** Clé de la 0.14.13, sans rôle : encore lue, remplacée à la prochaine modification. */
const legacyKey = (champ: number, enemy: number) => `${champ}:${enemy}`;

export type Notes = Record<string, string>;

export function useMatchupNotes(): [Notes, (n: Notes) => void] {
  return usePersistent<Notes>("spec.matchupNotes", {});
}

export function getNote(notes: Notes, champ: number, role: number, enemy: number): string {
  return notes[noteKey(champ, role, enemy)] ?? notes[legacyKey(champ, enemy)] ?? "";
}

export function withNote(notes: Notes, champ: number, role: number, enemy: number, text: string): Notes {
  const next = { ...notes };
  delete next[legacyKey(champ, enemy)];
  const k = noteKey(champ, role, enemy);
  if (text.trim()) next[k] = text.trim(); else delete next[k];
  return next;
}

/** Notes d'un champion dans un rôle (anciennes notes sans rôle comprises) : [adversaire, texte]. */
export function notesFor(notes: Notes, champ: number, role: number): [number, string][] {
  const out = new Map<number, string>();
  for (const [k, v] of Object.entries(notes)) {
    const p = k.split(":").map(Number);
    if (p.length === 2 && p[0] === champ && !out.has(p[1])) out.set(p[1], v);
    if (p.length === 3 && p[0] === champ && p[1] === role) out.set(p[2], v);
  }
  return [...out];
}
