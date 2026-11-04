// Historique de parties (client LoL et serveur Spec), détail d'une partie, profil d'un autre joueur,
// et suivi des LP gagnés ou perdus pendant que Spec est ouvert.
// Les autres joueurs n'apparaissent que dans une partie terminée ou un profil cherché, jamais en draft.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { ClientState } from "./lcu";
import { API_URL } from "./api";

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
  items: number[];          // objets 0 à 6 (6 = balise), puis celui de la quête de rôle s'il est connu
  spells: number[];         // D, F
  keystone: number;         // rune clé (0 si inconnue)
  subStyle: number;         // arbre secondaire (0 si inconnu)
  gold: number;
  damage: number;           // dégâts aux champions
}

/** Une ligne du détail d'une partie (les 10 joueurs). */
export interface PlayerLine {
  puuid: string | null;
  name: string;             // « Pseudo#TAG »
  icon: number | null;      // icône d'invocateur
  champ: number;
  role: number | null;
  spells: number[]; keystone: number; subStyle: number;
  items: number[];
  kills: number; deaths: number; assists: number;
  cs: number; gold: number; damage: number;
  vision: number | null;    // score de vision (absent des vieilles parties)
}
export interface GameDetail { duration: number; teams: { teamId: number; win: boolean; players: PlayerLine[] }[] }

interface Ranked { tier: string; division: string; leaguePoints: number }
interface RankedStats { queueMap?: Record<string, Ranked> }
interface QueueInfo { id: number; type?: string; isRanked?: boolean; mapId?: number; description?: string; shortName?: string }

const QUEUE_TYPE: Record<QueueKind, string | null> = { solo: "RANKED_SOLO_5x5", flex: "RANKED_FLEX_SR", "5c5": null, other: null };
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVISIONS = ["IV", "III", "II", "I"];
const LP_KEY = "spec.lp.games";
const BEFORE_KEY = "spec.lp.before";
const SERIES_KEY = "spec.lp.series";

/** Point de la courbe des LP (Solo/Duo) : LP « absolus » (promotions comprises) à un instant donné. */
export interface LpPoint { at: number; lp: number; game?: number }

export function readLpSeries(): LpPoint[] {
  try { const v = JSON.parse(localStorage.getItem(SERIES_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
/** Ajoute un point si les LP ont changé depuis le dernier (ou pour lier une partie à un point déjà noté). */
function pushLpPoint(p: LpPoint) {
  const list = readLpSeries();
  const last = list[list.length - 1];
  if (last && last.lp === p.lp && (!p.game || last.game === p.game)) return;
  if (p.game && list.some((x) => x.game === p.game)) return;
  list.push(p);
  try { localStorage.setItem(SERIES_KEY, JSON.stringify(list.slice(-600))); } catch { /* stockage plein */ }
}
/** Note les LP Solo/Duo actuels (au chargement du profil, en début de draft). */
export function noteSoloLp(r: RankedStats | null) {
  const lp = absoluteLp(r?.queueMap?.RANKED_SOLO_5x5);
  if (lp != null) pushLpPoint({ at: Date.now(), lp });
}
/** « Émeraude II · 47 LP » à partir de LP absolus. */
export function lpLabel(total: number, short = false): string {
  const apex = TIERS.length * 400;
  if (total >= apex) return short ? "Maître+" : `Maître+ · ${total - apex} LP`;
  const t = Math.max(0, Math.floor(total / 400)), d = Math.min(3, Math.floor((total % 400) / 100));
  const name = `${TIER_FR[TIERS[t]]} ${DIVISIONS[d]}`;
  return short ? name : `${name} · ${total % 100} LP`;
}

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

const SMITE = 11;

/**
 * Poste joué. L'historique résumé du client ne donne pas de poste fiable (son champ « lane » vaut
 * souvent JUNGLE pour tout le monde), donc : le poste officiel s'il est présent, sinon Châtiment = jungle,
 * sinon le poste le plus joué de ce champion en Master+ (hors jungle, puisqu'il n'avait pas Châtiment).
 */
function roleOf(p: { teamPosition?: string; individualPosition?: string; spell1Id?: number; spell2Id?: number; championId: number },
                guess?: Guess): number | null {
  const pos = p.teamPosition || p.individualPosition;
  if (pos && pos in POSITIONS) return POSITIONS[pos];
  const smite = p.spell1Id === SMITE || p.spell2Id === SMITE;
  if (smite) return 1;
  return guess ? guess(p.championId, true) : null;
}

function readLp(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LP_KEY) ?? "{}"); } catch { return {}; }
}

type Guess = (champ: number, notJungle: boolean) => number | null;
type RawStats = {
  win: boolean; kills: number; deaths: number; assists: number; totalMinionsKilled?: number;
  neutralMinionsKilled?: number; gameEndedInEarlySurrender?: boolean;
  item0?: number; item1?: number; item2?: number; item3?: number; item4?: number; item5?: number; item6?: number;
  roleBoundItem?: number; perk0?: number; perkSubStyle?: number; goldEarned?: number; totalDamageDealtToChampions?: number;
  visionScore?: number;
};
type RawParticipant = {
  participantId?: number; teamId?: number; championId: number; teamPosition?: string; individualPosition?: string;
  spell1Id?: number; spell2Id?: number; timeline?: { lane?: string; role?: string }; stats: RawStats;
};
type RawGame = {
  gameId: number; queueId: number; gameCreation: number; gameDuration: number; mapId?: number;
  participants: RawParticipant[];
  participantIdentities?: { participantId: number; player?: { gameName?: string; tagLine?: string; puuid?: string; summonerName?: string; profileIcon?: number } }[];
  teams?: { teamId: number; win?: string | boolean }[];
};
type RawHistory = { games?: { games?: RawGame[] } };

const n = (x: number | undefined) => (Number.isFinite(x) ? Math.max(0, Math.round(x as number)) : 0);
const seconds = (d: number) => (d > 10_000 ? Math.round(d / 1000) : d);
const itemsOf = (s: RawStats) => [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6, s.roleBoundItem].map(n);

/** Parties d'un historique du client (celui du joueur connecté ou d'un joueur cherché). */
async function parseHistory(raw: RawHistory, guess?: Guess): Promise<Game[]> {
  const [info, lp] = [await queues(), readLp()];
  const out: Game[] = [];
  for (const g of raw.games?.games ?? []) {
    const p = g.participants?.[0];   // un historique ne contient que le joueur concerné
    if (!p || (g.mapId != null && g.mapId !== 11)) continue;
    const q = info.get(g.queueId);
    const s = p.stats;
    const duration = seconds(g.gameDuration);
    out.push({
      id: g.gameId, queue: kindOf(g.queueId, q), queueName: q?.shortName || q?.description || "Partie",
      queueType: q?.type ?? QUEUE_TYPE[kindOf(g.queueId, q)],
      champ: p.championId, role: roleOf(p, guess), win: !!s.win,
      remake: duration < 300 || !!s.gameEndedInEarlySurrender,
      kills: s.kills, deaths: s.deaths, assists: s.assists,
      cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0),
      duration, created: g.gameCreation, lp: lp[String(g.gameId)] ?? null,
      items: itemsOf(s), spells: [n(p.spell1Id), n(p.spell2Id)], keystone: n(s.perk0), subStyle: n(s.perkSubStyle),
      gold: n(s.goldEarned), damage: n(s.totalDamageDealtToChampions),
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

/** Dernières parties sur la Faille du joueur connecté (client LoL), de la plus récente à la plus ancienne. */
export async function loadHistory(count = 50, guess?: Guess): Promise<Game[]> {
  return parseHistory(await invoke<RawHistory>("lcu_match_history", { count }), guess);
}

type ServerMatch = [string, number, number, number, number | null, number, number,
  [number, number, number, number, number, number, number, number[], number[], number, number] | null];

/**
 * Parties classées solo de la saison gardées par le serveur Spec (stats perso activées) : l'historique
 * reste complet même quand celui du client ne montre que quelques parties. `before` : page suivante.
 */
export async function loadServerHistory(client: string, before?: number, limit = 20, withKey?: string): Promise<Game[]> {
  if (!API_URL) return [];
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", String(before));
  if (withKey) q.set("with", withKey);
  const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(client)}/matches?${q}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { matches } = (await r.json()) as { matches: ServerMatch[] };
  const lp = readLp();
  return matches.map(([matchId, created, champ, role, , win, remake, d]) => {
    const id = Number(matchId.split("_")[1] ?? 0);
    const [duration, kills, deaths, assists, cs, gold, damage, items, spells, keystone, subStyle] =
      d ?? [0, 0, 0, 0, 0, 0, 0, [], [], 0, 0];
    return {
      id, queue: "solo" as const, queueName: "Solo/Duo", queueType: "RANKED_SOLO_5x5",
      champ, role: role >= 0 ? role : null, win: !!win, remake: !!remake,
      kills, deaths, assists, cs, duration, created, lp: lp[String(id)] ?? null,
      items, spells, keystone, subStyle, gold, damage,
    };
  });
}

/** Réunit les deux sources (une partie présente dans les deux n'apparaît qu'une fois), de la plus récente à la plus ancienne. */
export function mergeHistory(client: Game[], server: Game[]): Game[] {
  const byId = new Map<number, Game>();
  for (const g of server) byId.set(g.id, g);
  for (const g of client) {
    const s = byId.get(g.id);
    // le client connaît la file exacte ; le serveur connaît le poste officiel et l'objet de quête
    byId.set(g.id, s ? { ...g, role: s.role ?? g.role, items: g.items.some((i, k) => k === 7 && i > 0) ? g.items : s.items } : g);
  }
  return [...byId.values()].sort((a, b) => b.created - a.created);
}

const detailCache = new Map<number, Promise<GameDetail>>();

/** Détail d'une partie terminée : les 10 joueurs, comme dans le client (gardé en mémoire : une partie ne change plus). */
export function loadGameDetail(gameId: number, guess?: Guess): Promise<GameDetail> {
  if (!detailCache.has(gameId)) {
    if (detailCache.size > 200) detailCache.clear();
    detailCache.set(gameId, fetchGameDetail(gameId, guess).catch((e) => { detailCache.delete(gameId); throw e; }));
  }
  return detailCache.get(gameId)!;
}

async function fetchGameDetail(gameId: number, guess?: Guess): Promise<GameDetail> {
  const g = await invoke<RawGame>("lcu_game", { gameId });
  const ids = new Map((g.participantIdentities ?? []).map((x) => [x.participantId, x.player]));
  const teams = new Map<number, PlayerLine[]>();
  for (const p of g.participants ?? []) {
    const who = ids.get(p.participantId ?? -1);
    const name = who?.gameName ? `${who.gameName}#${who.tagLine ?? ""}` : who?.summonerName ?? "Joueur";
    const s = p.stats;
    const line: PlayerLine = {
      puuid: who?.puuid || null, name, icon: who?.profileIcon ?? null, champ: p.championId, role: roleOf(p, guess),
      spells: [n(p.spell1Id), n(p.spell2Id)], keystone: n(s.perk0), subStyle: n(s.perkSubStyle), items: itemsOf(s),
      kills: s.kills, deaths: s.deaths, assists: s.assists,
      cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0), gold: n(s.goldEarned), damage: n(s.totalDamageDealtToChampions),
      vision: Number.isFinite(s.visionScore) ? n(s.visionScore) : null,
    };
    const team = p.teamId ?? 100;
    teams.set(team, [...(teams.get(team) ?? []), line]);
  }
  const wins = new Map((g.teams ?? []).map((t) => [t.teamId, t.win === true || t.win === "Win"]));
  const order = [0, 1, 2, 3, 4];
  return {
    duration: seconds(g.gameDuration),
    teams: [...teams.entries()].sort((a, b) => a[0] - b[0]).map(([teamId, players]) => ({
      teamId, win: wins.get(teamId) ?? players.length > 0,
      players: players.sort((a, b) => order.indexOf(a.role ?? 9) - order.indexOf(b.role ?? 9)),
    })),
  };
}

export interface OtherPlayer {
  puuid: string; name: string; icon: number | null; level: number | null;
  rank: string | null; games: Game[];
}

/** Riot ID « Pseudo#TAG » → identifiant du joueur dans le client, ou un message d'erreur. */
export async function findPlayer(riotId: string): Promise<{ puuid: string } | { error: string }> {
  const m = /^\s*([^#]{3,16})#([A-Za-z0-9]{2,5})\s*$/u.exec(riotId);
  if (!m) return { error: "Écris le Riot ID complet, par exemple Pseudo#EUW." };
  try {
    const s = await invoke<{ puuid?: string }>("lcu_find_player", { gameName: m[1].trim(), tagLine: m[2] });
    return s.puuid ? { puuid: s.puuid } : { error: "Joueur introuvable sur ce serveur." };
  } catch (e) {
    if (e === "not_running") return { error: "Lance le client LoL pour chercher un joueur." };
    return { error: "Joueur introuvable sur ce serveur." };
  }
}

/** Profil d'un autre joueur via le client : rang Solo/Duo et ses 20 dernières parties. */
export async function loadPlayer(puuid: string, guess?: Guess): Promise<OtherPlayer> {
  const raw = await invoke<{
    summoner: { gameName?: string; tagLine?: string; displayName?: string; profileIconId?: number; summonerLevel?: number };
    ranked: RankedStats | null; history: RawHistory | null;
  }>("lcu_player", { puuid, count: 20 });
  const s = raw.summoner ?? {};
  return {
    puuid, name: s.gameName ? `${s.gameName}#${s.tagLine ?? ""}` : s.displayName ?? "Joueur",
    icon: s.profileIconId ?? null, level: s.summonerLevel ?? null,
    rank: rankText(raw.ranked?.queueMap?.RANKED_SOLO_5x5),
    games: raw.history ? await parseHistory(raw.history, guess) : [],
  };
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
        noteSoloLp(r);
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
            if (type === "RANKED_SOLO_5x5") pushLpPoint({ at: game.created + game.duration * 1000, lp: after, game: game.id });
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

/** Duo vu par le serveur Spec : clé opaque du partenaire, bilan, combos de champions, parties ensemble. */
export interface Duo {
  key: string; games: number; wins: number;
  combos: [number, number, number, number][];      // ton champion, le sien, parties, victoires
  matches: [string, number, number][];             // partie, son champion, ton champion
}

export async function loadDuos(client: string): Promise<Duo[]> {
  if (!API_URL) return [];
  const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(client)}/duos`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { duos: Duo[] }).duos;
}

/** Nom, icône et identifiant client du partenaire, lus dans le détail d'une partie jouée ensemble. */
export async function duoPartner(d: Duo, me: string | null): Promise<{ name: string; icon: number | null; puuid: string | null } | null> {
  for (const [matchId, partnerChamp] of d.matches.slice(0, 3)) {
    try {
      const detail = await loadGameDetail(Number(matchId.split("_")[1] ?? 0));
      const team = detail.teams.find((t) => t.players.some((p) => p.puuid === me)) ?? null;
      const p = (team?.players ?? detail.teams.flatMap((t) => t.players)).find((x) => x.champ === partnerChamp && x.puuid !== me);
      if (p) return { name: p.name, icon: p.icon, puuid: p.puuid };
    } catch { /* client fermé ou partie introuvable : on essaie la suivante */ }
  }
  return null;
}
