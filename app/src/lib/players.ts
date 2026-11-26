// Suggestions de la recherche de joueur : dernières recherches (gardées sur ce PC) et amis du client LoL.
// Rien de tout ça ne part au serveur de Spec.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { IN_APP } from "./lcu";

export interface RecentPlayer { puuid: string; name: string; tag: string; icon: number | null; rank: string | null; at: number }
export type FriendStatus = "inGame" | "championSelect" | "inQueue" | "chat" | "away" | "dnd" | "mobile" | "offline";
export interface Friend { puuid: string; name: string; tag: string; icon: number | null; status: FriendStatus; champ: number | null }

const KEY = "spec.recentPlayers";
const MAX_RECENT = 5;
const listeners = new Set<(l: RecentPlayer[]) => void>();

function readRecent(): RecentPlayer[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.puuid === "string" && typeof p.name === "string").slice(0, MAX_RECENT) : [];
  } catch { return []; }
}
function writeRecent(list: RecentPlayer[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* stockage plein ou indisponible */ }
  listeners.forEach((f) => f(list));
}

/** « Pseudo#TAG » → [Pseudo, TAG] (le tag est après le dernier #). */
export function splitRiotId(id: string): [string, string] {
  const i = id.lastIndexOf("#");
  return i < 0 ? [id, ""] : [id.slice(0, i), id.slice(i + 1)];
}

/** Profil ouvert : il passe en tête des dernières recherches (rang du jour où on l'a ouvert). */
export function addRecent(p: Omit<RecentPlayer, "at">) {
  writeRecent([{ ...p, at: Date.now() }, ...readRecent().filter((x) => x.puuid !== p.puuid)].slice(0, MAX_RECENT));
}
export function removeRecent(puuid: string) {
  writeRecent(readRecent().filter((x) => x.puuid !== puuid));
}
export function useRecentPlayers(): RecentPlayer[] {
  const [list, setList] = useState(readRecent);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  return list;
}

const ORDER: FriendStatus[] = ["inGame", "championSelect", "inQueue", "chat", "dnd", "away", "mobile", "offline"];
let friendsCache: { at: number; job: Promise<Friend[]> } | null = null;

/** Amis du client, du plus disponible au hors ligne. Gardés 30 s pour ne pas relire le client à chaque clic. */
export function loadFriends(): Promise<Friend[]> {
  if (!IN_APP) return Promise.resolve([]);
  if (friendsCache && Date.now() - friendsCache.at < 30_000) return friendsCache.job;
  const job = invoke<Friend[]>("lcu_friends").then((l) => [...l].sort((a, b) =>
    ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name)));
  job.catch(() => { friendsCache = null; });
  friendsCache = { at: Date.now(), job };
  return job;
}

/** Ce que tape le joueur correspond-il à ce Riot ID ? Renvoie la longueur du début de pseudo à mettre en gras, ou -1. */
export function matchLength(query: string, name: string, tag: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const [qn, qt] = q.includes("#") ? splitRiotId(q) : [q, null];
  if (!name.toLowerCase().startsWith(qn)) return -1;
  if (qt != null && !tag.toLowerCase().startsWith(qt)) return -1;
  return qn.length;
}
