// Synchro des stats perso, lancée chaque minute par le cron Cloudflare.
// Seul le cron appelle Riot : les requêtes de l'appli ne consomment jamais le budget de la clé.

import { Riot, rowsForPlayers, type PlayerRow } from "./riot";

export const IDS_REFRESH_MS = 20 * 60 * 1000;
export const INACTIVE_MS = 30 * 24 * 3600 * 1000;
const MAX_ID_CALLS = 4;

export interface SyncReport {
  idCalls: number;
  matchCalls: number;
  stored: number;
  stopped: "done" | "budget" | "rate_limited" | "auth" | "error";
}

interface PlayerState { puuid: string; ids_cursor: number | null; ids_refreshed_at: number | null }

export async function syncRun(db: D1Database, riot: Riot, seasonStart: number, now: number): Promise<SyncReport> {
  const report: SyncReport = { idCalls: 0, matchCalls: 0, stored: 0, stopped: "done" };
  const stop = (status: number): SyncReport["stopped"] =>
    status === 429 ? "rate_limited" : status === 401 || status === 403 ? "auth" : status === 0 ? "budget" : "error";

  // 1. Listes de parties : historique complet à l'inscription, puis les 100 plus récentes toutes les 20 min.
  const { results: players } = await db.prepare(
    `SELECT puuid, ids_cursor, ids_refreshed_at FROM players
     WHERE last_seen_at > ?1 AND (ids_cursor IS NOT NULL OR ids_refreshed_at IS NULL OR ids_refreshed_at < ?2)
     ORDER BY COALESCE(ids_refreshed_at, 0) LIMIT 2`,
  ).bind(now - INACTIVE_MS, now - IDS_REFRESH_MS).all<PlayerState>();

  for (const p of players) {
    if (report.idCalls >= MAX_ID_CALLS) break;
    const full = p.ids_cursor != null || p.ids_refreshed_at == null;
    let start = p.ids_cursor ?? 0;
    let cursor: number | null = full ? start : null;
    while (report.idCalls < MAX_ID_CALLS) {
      const res = await riot.matchIds(p.puuid, seasonStart, start);
      report.idCalls++;
      if (!res.ok) {
        report.stopped = stop(res.status);
        await savePlayer(db, p.puuid, cursor, now);
        return report;
      }
      await db.prepare(
        `INSERT OR IGNORE INTO pending (puuid, match_id)
         SELECT ?1, value FROM json_each(?2)
         WHERE value NOT IN (SELECT match_id FROM player_matches WHERE puuid = ?1)`,
      ).bind(p.puuid, JSON.stringify(res.data)).run();
      if (!full || res.data.length < 100) { cursor = null; break; }
      start += 100;
      cursor = start;
    }
    await savePlayer(db, p.puuid, cursor, now);
  }

  // 2. Détail des parties en attente, les plus récentes d'abord.
  const budget = riot.remaining;
  if (budget <= 0) { report.stopped = "budget"; return report; }
  const { results: pending } = await db.prepare(
    `SELECT DISTINCT match_id FROM pending
     ORDER BY CAST(substr(match_id, instr(match_id, '_') + 1) AS INTEGER) DESC LIMIT ?1`,
  ).bind(budget).all<{ match_id: string }>();
  if (pending.length === 0) return report;

  const { results: reg } = await db.prepare(`SELECT puuid FROM players`).all<{ puuid: string }>();
  const registered = new Set(reg.map((r) => r.puuid));
  const rows: PlayerRow[] = [];
  const done: string[] = [];

  for (const { match_id } of pending) {
    const res = await riot.match(match_id);
    report.matchCalls++;
    if (res.ok) {
      rows.push(...rowsForPlayers(res.data, registered));
      done.push(match_id);
    } else if (res.status === 404) {
      done.push(match_id);
    } else {
      report.stopped = stop(res.status);
      break;
    }
  }

  if (rows.length) {
    await db.prepare(
      `INSERT OR REPLACE INTO player_matches
         (puuid, match_id, game_creation, champion_id, role, opponent_id, win, remake, detail)
       SELECT json_extract(value, '$.puuid'), json_extract(value, '$.matchId'),
              json_extract(value, '$.gameCreation'), json_extract(value, '$.championId'),
              json_extract(value, '$.role'), json_extract(value, '$.opponentId'),
              json_extract(value, '$.win'), json_extract(value, '$.remake'), json(json_extract(value, '$.detail'))
       FROM json_each(?1)`,
    ).bind(JSON.stringify(rows.map((r) => ({ ...r, win: r.win ? 1 : 0, remake: r.remake ? 1 : 0 })))).run();
    report.stored = rows.length;
  }
  if (done.length) {
    await db.prepare(`DELETE FROM pending WHERE match_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(done)).run();
  }
  return report;
}

async function savePlayer(db: D1Database, puuid: string, cursor: number | null, now: number) {
  await db.prepare(`UPDATE players SET ids_cursor = ?2, ids_refreshed_at = ?3 WHERE puuid = ?1`)
    .bind(puuid, cursor, now).run();
}
