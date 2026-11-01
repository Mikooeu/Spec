// Appels Riot (match-v5) et lecture d'une partie. La clé ne sort jamais de l'en-tête.

export const RANKED_SOLO = 420;
const POSITIONS: Record<string, number> = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 };

export type RiotResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; retryAfter?: number };

export class Riot {
  calls = 0;
  // `fetch` est toujours appelé sans objet devant : `this.fetcher(...)` déclenche
  // « Illegal invocation » sur Cloudflare.
  private fetcher: typeof fetch;
  constructor(private key: string, private region: string, private budget: number,
              fetcher?: typeof fetch) {
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }

  get remaining() { return this.budget - this.calls; }

  async get<T>(path: string): Promise<RiotResult<T>> {
    if (this.calls >= this.budget) return { ok: false, status: 0 };
    this.calls++;
    const call = this.fetcher;
    const resp = await call(`https://${this.region}.api.riotgames.com${path}`, {
      headers: { "X-Riot-Token": this.key },
    });
    if (resp.ok) return { ok: true, data: (await resp.json()) as T };
    const retry = Number(resp.headers.get("Retry-After") ?? "");
    return { ok: false, status: resp.status, retryAfter: Number.isFinite(retry) ? retry : undefined };
  }

  matchIds(puuid: string, startTime: number, start: number, count = 100) {
    const q = new URLSearchParams({
      queue: String(RANKED_SOLO), type: "ranked",
      startTime: String(Math.floor(startTime / 1000)), start: String(start), count: String(count),
    });
    return this.get<string[]>(`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${q}`);
  }

  account(gameName: string, tagLine: string) {
    return this.get<{ puuid: string }>(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }

  match(id: string) {
    return this.get<MatchDto>(`/lol/match/v5/matches/${encodeURIComponent(id)}`);
  }
}

export interface MatchDto {
  metadata: { matchId: string; participants: string[] };
  info: {
    queueId: number;
    gameCreation: number;
    gameDuration: number;
    participants: {
      puuid: string; championId: number; teamId: number; teamPosition: string; win: boolean;
      gameEndedInEarlySurrender?: boolean;
    }[];
  };
}

export interface PlayerRow {
  puuid: string; matchId: string; gameCreation: number; championId: number;
  role: number; opponentId: number | null; win: boolean; remake: boolean;
}

/** Lignes à enregistrer pour les joueurs inscrits présents dans la partie. */
export function rowsForPlayers(m: MatchDto, registered: Set<string>): PlayerRow[] {
  if (m.info.queueId !== RANKED_SOLO) return [];
  const remake = m.info.gameDuration < 300 || m.info.participants.some((p) => p.gameEndedInEarlySurrender);
  return m.info.participants
    .filter((p) => registered.has(p.puuid))
    .map((p) => {
      const role = POSITIONS[p.teamPosition] ?? -1;
      const opp = role >= 0
        ? m.info.participants.find((o) => o.teamId !== p.teamId && o.teamPosition === p.teamPosition)
        : undefined;
      return {
        puuid: p.puuid, matchId: m.metadata.matchId, gameCreation: m.info.gameCreation,
        championId: p.championId, role, opponentId: opp?.championId ?? null, win: p.win, remake,
      };
    });
}
