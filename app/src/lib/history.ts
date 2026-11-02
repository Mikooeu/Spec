// Historique de parties (client LoL) et suivi des LP gagnés ou perdus pendant que Spec est ouvert.
// Seules les données du joueur connecté sont lues : aucun autre joueur n'apparaît.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { ClientState } from "./lcu";

export type QueueKind = "solo" | "flex" | "5c5" | "other";
export const QUEUE_LABELS: Record<QueueKind, string> = { solo: "Solo/Duo", flex: "Flex", "5c5": "5c5", other: "Autre" };

export interface Game {
  id: number;
  queue: QueueKind;
  queueName: string;
  queueType: string | null; // type de file du client (« RANKED_SOLO_5x5 »…), pour retrouver les LP
  champ: number;
  role: number | null;      // index dans ROLES, null si inconnu
  win: boolean;
  remake: boolean;
  kills: number; deaths: number; assists: number;
  cs: number;
  duration: number;         // secondes
  created: number;          // epoch ms
  lp: number | null;        // LP gagnés (+) ou perdus (−), null si la partie n'a pas été suivie
}

interface Ranked { tier: string; division: string; leaguePoints: number }
interface RankedStats { queueMap?: Record<string, Ranked> }
interface QueueInfo { id: number; type?: string; isRanked?: boolean; mapId?: number; description?: string; shortName?: string }

const QUEUE_TYPE: Record<QueueKind, string | null> = { solo: "RANKED_SOLO_5x5", flex: "RANKED_FLEX_SR", "5c5": null, other: null };
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVISIONS = ["IV", "III", "II", "I"];
const LP_KEY = "spec.lp.games";
const BEFORE_KEY = "spec.lp.before";

const get = <T,>(path: string) => invoke<T>("lcu_get", { path });

/** Rang Solo/Duo : « Émeraude II · 47 LP », ou null si non classé. */
const TIER_FR: Record<string, string> = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or", PLATINUM: "Platine", EMERALD: "Émeraude",
  DIAMOND: "Diamant", MASTER: "Maître", GRANDMASTER: "Grand Maître", CHALLENGER: "Challenger",
};
export function rankText(r: Ranked | undefined): string | null {
  if (!r || !r.tier || r.tier === "NONE" || r.tier === "") return null;
  const apex = !TIERS.includes(r.tier);
  return `${TIER_FR[r.tier] ?? r.tier}${apex || !r.division || r.division === "NA" ? "" : ` ${r.division}`} · ${r.leaguePoints} LP`;
}

export async function readRanked(): Promise<RankedStats | null> {
  try { return await get<RankedStats>("/lol-ranked/v1/current-ranked-stats"); } catch { return null; }
}

/** LP « absolus » pour comparer avant / après une partie, promotions comprises. */
function absoluteLp(r: Ranked | undefined): number | null {
  if (!r || !r.tier || r.tier === "NONE") return null;
  const t = TIERS.indexOf(r.tier);
  if (t < 0) return TIERS.length * 400 + r.leaguePoints;          // Maître et au-dessus
  return t * 400 + Math.max(0, DIVISIONS.indexOf(r.division)) * 100 + r.leaguePoints;
}

let queuesCache: Promise<Map<number, QueueInfo>> | null = null;
function queues(): Promise<Map<number, QueueInfo>> {
  if (!queuesCache) {
    queuesCache = get<QueueInfo[]>("/lol-game-queues/v1/queues")
      .then((list) => new Map(list.map((q) => [q.id, q])))
      .catch(() => { queuesCache = null; return new Map(); });
  }
  return queuesCache;
}

function kindOf(queueId: number, info: QueueInfo | undefined): QueueKind {
  if (queueId === 420 || info?.type === "RANKED_SOLO_5x5") return "solo";
  if (queueId === 440 || info?.type === "RANKED_FLEX_SR") return "flex";
  if (info?.isRanked && (info.mapId ?? 11) === 11) return "5c5";   // classé 5 contre 5 en équipe complète
  return "other";
}

const POSITIONS: Record<string, number> = { TOP: 0, JUNGLE: 1, MIDDLE: 2, MID: 2, BOTTOM: 3, UTILITY: 4, SUPPORT: 4 };

function roleOf(p: { teamPosition?: string; individualPosition?: string; timeline?: { lane?: string; role?: string } }): number | null {
  const pos = p.teamPosition || p.individualPosition;
  if (pos && pos in POSITIONS) return POSITIONS[pos];
  const lane = p.timeline?.lane, role = p.timeline?.role;
  if (lane === "BOTTOM" || lane === "BOT") return role === "DUO_SUPPORT" ? 4 : 3;
  return lane && lane in POSITIONS ? POSITIONS[lane] : null;
}

function readLp(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LP_KEY) ?? "{}"); } catch { return {}; }
}

/** Dernières parties sur la Faille, de la plus récente à la plus ancienne. */
export async function loadHistory(count = 50): Promise<Game[]> {
  type RawGame = {
    gameId: number; queueId: number; gameCreation: number; gameDuration: number; mapId?: number;
    participants: { championId: number; teamPosition?: string; individualPosition?: string;
      timeline?: { lane?: string; role?: string };
      stats: { win: boolean; kills: number; deaths: number; assists: number; totalMinionsKilled?: number;
               neutralMinionsKilled?: number; gameEndedInEarlySurrender?: boolean } }[];
  };
  const raw = await invoke<{ games?: { games?: RawGame[] } }>("lcu_match_history", { count });
  const [info, lp] = [await queues(), readLp()];
  const out: Game[] = [];
  for (const g of raw.games?.games ?? []) {
    const p = g.participants?.[0];   // l'historique du joueur connecté ne contient que lui
    if (!p || (g.mapId != null && g.mapId !== 11)) continue;
    const q = info.get(g.queueId);
    const s = p.stats;
    const duration = g.gameDuration > 10_000 ? Math.round(g.gameDuration / 1000) : g.gameDuration;
    out.push({
      id: g.gameId, queue: kindOf(g.queueId, q), queueName: q?.shortName || q?.description || "Partie",
      queueType: q?.type ?? QUEUE_TYPE[kindOf(g.queueId, q)],
      champ: p.championId, role: roleOf(p), win: !!s.win,
      remake: duration < 300 || !!s.gameEndedInEarlySurrender,
      kills: s.kills, deaths: s.deaths, assists: s.assists,
      cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0),
      duration, created: g.gameCreation, lp: lp[String(g.gameId)] ?? null,
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

/**
 * Suivi des LP : on note le rang au début de chaque partie, puis on le relit après la partie
 * (le client met quelques secondes à le mettre à jour) et on associe l'écart à la dernière partie classée.
 */
export function useLpTracking(client: ClientState): number {
  const phase = client.status === "idle" ? client.phase : client.status === "champselect" ? "ChampSelect" : "";
  const last = useRef(phase);
  const [version, setVersion] = useState(0);   // change quand un nouvel écart de LP est enregistré

  useEffect(() => {
    const prev = last.current;
    last.current = phase;
    if (phase === prev) return;
    if (phase === "ChampSelect" || phase === "InProgress") {
      readRanked().then((r) => {
        if (r?.queueMap) localStorage.setItem(BEFORE_KEY, JSON.stringify({ at: Date.now(), queueMap: r.queueMap }));
      });
    }
    if (phase === "EndOfGame" || phase === "PreEndOfGame") {
      let tries = 0;
      const check = async () => {
        tries += 1;
        const saved = (() => { try { return JSON.parse(localStorage.getItem(BEFORE_KEY) ?? "null"); } catch { return null; } })();
        if (!saved?.queueMap) return;
        const [now, games] = await Promise.all([readRanked(), loadHistory(1).catch(() => [] as Game[])]);
        const game = games[0];
        const type = game && game.queue !== "other" ? game.queueType : null;
        if (game && type && now?.queueMap && game.created >= saved.at - 6 * 3600_000) {
          const before = absoluteLp(saved.queueMap[type]), after = absoluteLp(now.queueMap[type]);
          if (before != null && after != null && (after !== before || tries >= 6)) {
            const map = readLp();
            map[String(game.id)] = after - before;
            localStorage.setItem(LP_KEY, JSON.stringify(map));
            localStorage.removeItem(BEFORE_KEY);
            setVersion((v) => v + 1);
            return;
          }
        }
        if (tries < 6) window.setTimeout(check, 10_000);   // jusqu'à une minute d'attente
      };
      window.setTimeout(check, 5_000);
    }
  }, [phase]);
  return version;
}
