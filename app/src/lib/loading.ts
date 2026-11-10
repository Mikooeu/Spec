// Écran de chargement : les 10 joueurs de la partie, leur rang, leur forme et leurs parties sur le champion joué.
// Les noms ne sont lus qu'une fois la draft terminée (ils sont alors affichés par le jeu lui-même).
// La page de l'appli calcule tout et l'écrit dans le localStorage ; la fenêtre par-dessus le jeu le relit.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { API_URL } from "./api";
import { parseHistory, type Game, type Guess, type RawHistory } from "./history";
import type { Stats } from "./score";

export type Tag = "form" | "tilt" | "otp" | "offrole" | "fresh";
export type Duel = "up2" | "up" | "eq" | "down" | "down2";
export interface LoadPlayer {
  puuid: string;
  name: string;
  champ: number;
  champName: string;
  champKey: string;             // clé Data Dragon (images)
  skin: number;
  role: number | null;
  spells: [number, number];
  keystone: number | null;      // rune clé et arbre secondaire (serveur Spec pour les 10, sinon les tiennes seulement)
  subStyle: number | null;
  tier: string | null;          // « emerald », null si non classé
  division: string | null;      // « II » (vide pour Maître et plus)
  lp: number | null;
  wins: number; losses: number; // Solo/Duo, toute la saison (client LoL)
  streak: number;               // > 0 : victoires d'affilée, < 0 : défaites
  champGames: number; champWins: number;   // sur ses 100 dernières parties
  tags: Tag[];
  me: boolean;
}
export interface LoadingData { at: number; ddragon: string; queue: string; allies: LoadPlayer[]; enemies: LoadPlayer[]; duels: Duel[] }

const KEY = "spec.loading";
const HISTORY = 100;
const POS: Record<string, number> = { TOP: 0, JUNGLE: 1, MIDDLE: 2, MID: 2, BOTTOM: 3, BOT: 3, ADC: 3, UTILITY: 4, SUPPORT: 4 };

interface RawMember { puuid?: string; championId?: number; selectedPosition?: string; gameName?: string; summonerName?: string; tagLine?: string }
interface RawSelection { puuid?: string; championId?: number; selectedSkinIndex?: number; spell1Id?: number; spell2Id?: number }
interface RawSession {
  gameData?: { teamOne?: RawMember[]; teamTwo?: RawMember[]; playerChampionSelections?: RawSelection[]; queue?: { description?: string; type?: string } };
}
interface RawRank { tier?: string; division?: string; leaguePoints?: number; wins?: number; losses?: number }

/** Lit la partie dans le client puis le profil des 10 joueurs (un à la fois pour garder le client fluide). */
export async function loadLoading(stats: Stats, mePuuid: string | null, guess?: Guess): Promise<LoadingData | null> {
  const s = await invoke<RawSession>("lcu_get", { path: "/lol-gameflow/v1/session" });
  const gd = s.gameData;
  if (!gd?.teamOne?.length || !gd.teamTwo?.length) return null;
  const sel = new Map((gd.playerChampionSelections ?? []).map((x) => [x.puuid, x]));
  const mine = gd.teamTwo.some((m) => m.puuid && m.puuid === mePuuid) ? 2 : 1;
  const build = async (m: RawMember): Promise<LoadPlayer> => {
    const puuid = m.puuid ?? "";
    const pick = sel.get(puuid);
    const champ = m.championId || pick?.championId || 0;
    const role = m.selectedPosition ? POS[m.selectedPosition.toUpperCase()] ?? null : null;
    let rank: RawRank | undefined, games: Game[] = [], level: number | null = null, name = m.gameName || m.summonerName || "";
    if (puuid) {
      try {
        const raw = await invoke<{ summoner?: { gameName?: string; summonerLevel?: number }; ranked?: { queueMap?: Record<string, RawRank> }; history?: RawHistory }>(
          "lcu_player", { puuid, count: HISTORY });
        rank = raw.ranked?.queueMap?.RANKED_SOLO_5x5;
        level = raw.summoner?.summonerLevel ?? null;
        name = name || raw.summoner?.gameName || "";
        games = raw.history ? await parseHistory(raw.history, guess) : [];
      } catch { /* profil privé ou client lent : la carte reste sans stats */ }
    }
    const c = stats.champions.get(champ);
    return { ...playerOf(puuid, name, champ, pick, role, rank, games, level, puuid === mePuuid), champName: c?.name ?? "", champKey: c?.key ?? "" };
  };
  const order = (list: LoadPlayer[]) => [...list].sort((a, b) => (a.role ?? 9) - (b.role ?? 9));
  const one: LoadPlayer[] = [], two: LoadPlayer[] = [];
  for (const m of gd.teamOne) one.push(await build(m));
  for (const m of gd.teamTwo) two.push(await build(m));
  await addRunes([...one, ...two], one, mePuuid);
  const allies = order(mine === 1 ? one : two), enemies = order(mine === 1 ? two : one);
  return { at: Date.now(), ddragon: stats.ddragon, queue: gd.queue?.description ?? "", allies, enemies, duels: allies.map((a, i) => duel(stats, a, enemies[i])) };
}

/** Runes : les 10 via le serveur Spec (joueur inscrit, API spectator de Riot), sinon les tiennes depuis le client. */
async function addRunes(all: LoadPlayer[], teamOne: LoadPlayer[], mePuuid: string | null): Promise<void> {
  if (API_URL && mePuuid) {
    try {
      const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(mePuuid)}/live`);
      if (r.ok) {
        const { runes } = await r.json() as { runes: [number, number, number, number][] };
        for (const p of all) {
          const team = teamOne.includes(p) ? 100 : 200;
          const hit = runes.find(([c, tm]) => c === p.champ && tm === team) ?? runes.find(([c]) => c === p.champ);
          if (hit) { p.keystone = hit[2]; p.subStyle = hit[3]; }
        }
        if (all.some((p) => p.keystone)) return;
      }
    } catch { /* serveur injoignable : on passe aux runes du client */ }
  }
  const me = all.find((p) => p.me);
  if (!me) return;
  try {
    const page = await invoke<{ selectedPerkIds?: number[]; subStyleId?: number }>("lcu_get", { path: "/lol-perks/v1/currentpage" });
    me.keystone = page.selectedPerkIds?.[0] ?? null; me.subStyle = page.subStyleId ?? null;
  } catch { /* pas de page lisible */ }
}

function playerOf(puuid: string, name: string, champ: number, pick: RawSelection | undefined, role: number | null,
  rank: RawRank | undefined, games: Game[], level: number | null, me: boolean): Omit<LoadPlayer, "champName" | "champKey"> {
  const played = games.filter((g) => !g.remake);
  let streak = 0;
  for (const g of played) {
    if (streak === 0) streak = g.win ? 1 : -1;
    else if ((streak > 0) === g.win) streak += g.win ? 1 : -1;
    else break;
  }
  const onChamp = played.filter((g) => g.champ === champ);
  const ranked = (rank?.wins ?? 0) + (rank?.losses ?? 0);
  const tags: Tag[] = [];
  if (streak >= 3) tags.push("form");
  if (streak <= -3) tags.push("tilt");
  if (played.length >= 10 && onChamp.length / played.length >= 0.6) tags.push("otp");
  const inRole = role == null ? null : played.filter((g) => g.role === role).length;
  if (inRole != null && played.length >= 10 && inRole / played.length <= 0.1) tags.push("offrole");
  if ((level != null && level < 40) || (rank && ranked < 20)) tags.push("fresh");
  const tier = rank?.tier && rank.tier !== "NONE" && rank.tier !== "" ? rank.tier.toLowerCase() : null;
  return {
    puuid, name, champ, skin: pick?.selectedSkinIndex ?? 0, role,
    spells: [pick?.spell1Id ?? 4, pick?.spell2Id ?? 14], keystone: null, subStyle: null,
    tier, division: tier && rank?.division && rank.division !== "NA" ? rank.division : null,
    lp: tier ? rank?.leaguePoints ?? 0 : null, wins: rank?.wins ?? 0, losses: rank?.losses ?? 0,
    streak, champGames: onChamp.length, champWins: onChamp.filter((g) => g.win).length,
    tags: tags.slice(0, 2), me,
  };
}

const TIER_ORDER = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];
const DIV = { IV: 0, III: 1, II: 2, I: 3 } as Record<string, number>;
/** Niveau en divisions (Fer IV = 0, Émeraude I = 23, Maître = 28 + LP/100). */
export function rankLevel(p: LoadPlayer): number | null {
  if (!p.tier) return null;
  const t = TIER_ORDER.indexOf(p.tier);
  return t >= 7 ? 28 + (p.lp ?? 0) / 100 : t * 4 + (DIV[p.division ?? "IV"] ?? 0) + (p.lp ?? 0) / 100;
}

/** Face-à-face : winrate Master+ du matchup (≥ 30 parties), puis écart de forme et de rang entre les deux joueurs. */
export function duel(stats: Stats, a: LoadPlayer, e: LoadPlayer | undefined): Duel {
  if (!e || a.role == null) return "eq";
  const [g, w] = stats.vs.get(`${a.champ}|${a.role}|${e.champ}`) ?? [0, 0];
  const matchup = g >= 30 ? w / g - 0.5 : 0;
  const wr = (p: LoadPlayer) => (p.wins + p.losses >= 10 ? p.wins / (p.wins + p.losses) - 0.5 : 0);
  const ra = rankLevel(a), re = rankLevel(e);
  const score = matchup * 2 + (wr(a) - wr(e)) * 0.5 + (ra != null && re != null ? (ra - re) * 0.01 : 0);
  return score > 0.06 ? "up2" : score > 0.02 ? "up" : score < -0.06 ? "down2" : score < -0.02 ? "down" : "eq";
}

export function saveLoading(d: LoadingData | null): void {
  try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch { /* plein */ }
}

/** Fenêtre par-dessus le jeu : relit les données écrites par la page de l'appli. */
export function useSavedLoading(): LoadingData | null {
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as LoadingData | null; } catch { return null; } };
  const [d, setD] = useState(read);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === KEY) setD(read()); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  return d;
}
