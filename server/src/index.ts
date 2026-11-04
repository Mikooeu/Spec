// Serveur Spec : stats Master+ pour l'appli, stats perso des amis inscrits.
//
// Sécurité :
// - la clé Riot, le jeton admin et le code d'invitation sont des secrets Cloudflare ;
// - les routes publiques ne déclenchent jamais d'appel Riot (seul le cron en fait) ;
// - inscription sur code d'invitation, nombre de joueurs plafonné ;
// - aucun pseudo stocké : le Riot ID sert une fois à l'inscription, puis seuls le PUUID,
//   l'identifiant du client LoL (haché) et les champions joués sont gardés.

import { Riot } from "./riot";
import { syncRun } from "./sync";

export interface Env {
  DB: D1Database;
  STATS: KVNamespace;
  RIOT_API_KEY: string;
  ADMIN_TOKEN: string;
  INVITE_CODE: string;
  RIOT_REGION: string;
  SEASON_START: string;
  MAX_PLAYERS: string;
  RIOT_BUDGET_PER_RUN: string;
}

const MAX_STATS_BYTES = 24 * 1024 * 1024;
/** Stats par région : l'EUW garde la clé historique « stats » (anciennes versions de l'appli). */
const STATS_KEYS: Record<string, string> = { euw: "stats", kr: "stats-kr", na: "stats-na", world: "stats-world" };
function statsKey(url: URL): string | null {
  return STATS_KEYS[url.searchParams.get("region") ?? "euw"] ?? null;
}
const MAX_PATH = 512;
const DEVICE_WINDOW_MS = 15 * 60 * 1000;

/** Retire les « / » finaux en temps linéaire (une regex /\/+$/ peut devenir quadratique). */
export function trimSlashes(p: string): string {
  let end = p.length;
  while (end > 1 && p.charCodeAt(end - 1) === 47) end--;
  return p.slice(0, end) || "/";
}
const PUUID_RE = /^[A-Za-z0-9_-]{60,100}$/;      // PUUID de l'API Riot (chiffré)
const CLIENT_RE = /^[A-Za-z0-9_-]{20,100}$/;     // identifiant du joueur dans le client LoL
const RIOT_ID_RE = /^([^#\/?]{3,16})#([A-Za-z0-9]{2,5})$/u;

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}
const error = (status: number, code: string) => json({ error: code }, status);

/** Comparaison en temps constant (les deux valeurs sont d'abord hachées à la même taille). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function isAdmin(req: Request, env: Env) {
  const auth = req.headers.get("Authorization") ?? "";
  return env.ADMIN_TOKEN?.length >= 32 && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), env.ADMIN_TOKEN);
}

/** Clé opaque d'un partenaire de duo, propre à chaque joueur (on ne peut pas en déduire le PUUID). */
async function duoKey(me: string, partner: string): Promise<string> {
  return (await sha256Hex(`duo:${me}:${partner}`)).slice(0, 16);
}

async function partnerFromKey(env: Env, me: string, key: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}$/.test(key)) return null;
  const { results } = await env.DB.prepare(`SELECT puuid FROM players WHERE puuid <> ?1`).bind(me).all<{ puuid: string }>();
  for (const r of results) if ((await duoKey(me, r.puuid)) === key) return r.puuid;
  return null;
}

export async function handle(req: Request, env: Env, now = Date.now(), fetcher?: typeof fetch): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.length > MAX_PATH) return error(414, "uri_too_long");
  const path = trimSlashes(url.pathname);
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    if (method === "GET" && path === "/v1/health") return json({ ok: true });

    // Stats Master+ publiées par `python -m scoring export --upload`
    if (method === "GET" && path === "/v1/stats") {
      const key = statsKey(url);
      if (!key) return error(400, "bad_region");
      const { value, metadata } = await env.STATS.getWithMetadata<{ etag: string }>(key, "stream");
      if (!value) return error(404, "no_stats");
      const etag = metadata?.etag ? `"${metadata.etag}"` : undefined;
      if (etag && req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: CORS });
      return new Response(value, {
        headers: {
          "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300",
          ...(etag ? { ETag: etag } : {}), ...CORS,
        },
      });
    }

    if (method === "PUT" && path === "/admin/stats") {
      if (!(await isAdmin(req, env))) return error(401, "unauthorized");
      const key = statsKey(url);
      if (!key) return error(400, "bad_region");
      const size = Number(req.headers.get("Content-Length") ?? "0");
      if (size > MAX_STATS_BYTES) return error(413, "too_large");
      const text = await req.text();
      if (text.length > MAX_STATS_BYTES) return error(413, "too_large");
      let parsed: { meta?: unknown; champions?: unknown; base?: unknown };
      try { parsed = JSON.parse(text); } catch { return error(400, "bad_json"); }
      if (!parsed.meta || !Array.isArray(parsed.champions) || !Array.isArray(parsed.base)) return error(400, "bad_stats");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
      const etag = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
      await env.STATS.put(key, text, { metadata: { etag, updatedAt: now } });
      return json({ ok: true, bytes: text.length, etag });
    }

    // Inscription d'un ami (une fois, avec le code d'invitation). Seule route qui appelle Riot :
    // un appel account-v1 pour retrouver le PUUID, après vérification du code.
    if (method === "POST" && path === "/v1/players") {
      let body: { client?: unknown; riotId?: unknown; invite?: unknown };
      try { body = await req.json(); } catch { return error(400, "bad_json"); }
      const client = typeof body.client === "string" ? body.client : "";
      if (!CLIENT_RE.test(client)) return error(400, "bad_client");
      const clientHash = await sha256Hex(client);
      const known = await env.DB.prepare(`SELECT 1 FROM devices WHERE client_hash = ?1`).bind(clientHash).first();
      if (known) return json({ ok: true, registered: true });
      if (typeof body.invite !== "string" || !(await safeEqual(body.invite.trim().toUpperCase(), env.INVITE_CODE ?? ""))) {
        return error(403, "bad_invite");
      }
      const rid = typeof body.riotId === "string" ? RIOT_ID_RE.exec(body.riotId.trim()) : null;
      if (!rid) return error(400, "bad_riot_id");
      const riot = new Riot(env.RIOT_API_KEY, env.RIOT_REGION || "europe", 1, fetcher);
      const acc = await riot.account(rid[1], rid[2]);
      if (!acc.ok) return acc.status === 404 ? error(404, "unknown_riot_id") : error(503, "riot_unavailable");
      const puuid = acc.data.puuid;
      if (!PUUID_RE.test(puuid)) return error(502, "bad_riot_response");

      // Un compte déjà lié n'accepte un nouvel appareil que si l'admin a ouvert une fenêtre (15 min, usage unique).
      const existing = await env.DB.prepare(
        `SELECT device_window_until AS until, (SELECT COUNT(*) FROM devices d WHERE d.puuid = p.puuid) AS devices
         FROM players p WHERE puuid = ?1`,
      ).bind(puuid).first<{ until: number | null; devices: number }>();
      if (existing) {
        if (existing.devices > 0 && !(existing.until && existing.until > now)) return error(409, "already_linked");
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO devices (client_hash, puuid, created_at) VALUES (?1, ?2, ?3)`)
            .bind(clientHash, puuid, now),
          env.DB.prepare(`UPDATE players SET device_window_until = NULL WHERE puuid = ?1`).bind(puuid),
        ]);
        return json({ ok: true, registered: true }, 201);
      }
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players`).first<number>("n");
      if ((count ?? 0) >= Number(env.MAX_PLAYERS || 20)) return error(409, "full");
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO players (puuid, created_at, last_seen_at) VALUES (?1, ?2, ?2)`)
          .bind(puuid, now),
        env.DB.prepare(`INSERT OR IGNORE INTO devices (client_hash, puuid, created_at) VALUES (?1, ?2, ?3)`)
          .bind(clientHash, puuid, now),
      ]);
      return json({ ok: true, registered: true }, 201);
    }

    // Historique détaillé d'un joueur inscrit (parties classées solo de la saison), page par page.
    // `with=<clé de duo>` : seulement les parties jouées avec ce joueur (dans la même équipe).
    const h = /^\/v1\/players\/([^/]+)\/matches$/.exec(path);
    if (method === "GET" && h) {
      const client = decodeURIComponent(h[1]);
      if (!CLIENT_RE.test(client)) return error(400, "bad_client");
      const player = await env.DB.prepare(`SELECT puuid FROM devices WHERE client_hash = ?1`)
        .bind(await sha256Hex(client)).first<{ puuid: string }>();
      if (!player) return error(404, "not_registered");
      const before = Number(url.searchParams.get("before") ?? "");
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));
      const withKey = url.searchParams.get("with");
      let partner: string | null = null;
      if (withKey) {
        partner = await partnerFromKey(env, player.puuid, withKey);
        if (!partner) return json({ matches: [] }, 200, { "Cache-Control": "no-store" });
      }
      const { results } = await env.DB.prepare(
        `SELECT a.match_id AS id, a.game_creation AS t, a.champion_id AS c, a.role AS r, a.opponent_id AS o, a.win AS w,
                a.remake AS x, a.detail AS d
         FROM player_matches a
         WHERE a.puuid = ?1 AND a.game_creation < ?2
           AND (?4 IS NULL OR EXISTS (SELECT 1 FROM player_matches b WHERE b.match_id = a.match_id AND b.puuid = ?4 AND b.win = a.win))
         ORDER BY a.game_creation DESC LIMIT ?3`,
      ).bind(player.puuid, Number.isFinite(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER, limit, partner)
        .all<{ id: string; t: number; c: number; r: number; o: number | null; w: number; x: number; d: string | null }>();
      return json({
        matches: results.map((m) => [m.id, m.t, m.c, m.r, m.o, m.w, m.x, m.d ? JSON.parse(m.d) : null]),
      }, 200, { "Cache-Control": "no-store" });
    }

    // Duo : parties classées solo jouées dans la même équipe qu'un autre joueur inscrit.
    // Aucun pseudo : chaque joueur est désigné par une clé opaque ; l'appli retrouve son nom dans le client LoL.
    const du = /^\/v1\/players\/([^/]+)\/duos$/.exec(path);
    if (method === "GET" && du) {
      const client = decodeURIComponent(du[1]);
      if (!CLIENT_RE.test(client)) return error(400, "bad_client");
      const player = await env.DB.prepare(`SELECT puuid FROM devices WHERE client_hash = ?1`)
        .bind(await sha256Hex(client)).first<{ puuid: string }>();
      if (!player) return error(404, "not_registered");
      const { results } = await env.DB.prepare(
        `SELECT b.puuid AS p, a.match_id AS id, a.game_creation AS t, a.champion_id AS c, b.champion_id AS pc, a.win AS w
         FROM player_matches a JOIN player_matches b
           ON b.match_id = a.match_id AND b.puuid <> a.puuid AND b.win = a.win
         WHERE a.puuid = ?1 AND a.remake = 0
         ORDER BY a.game_creation DESC`,
      ).bind(player.puuid).all<{ p: string; id: string; t: number; c: number; pc: number; w: number }>();
      const by = new Map<string, { games: number; wins: number; combos: Map<string, [number, number, number, number]>; matches: [string, number, number][] }>();
      for (const r of results) {
        const d = by.get(r.p) ?? { games: 0, wins: 0, combos: new Map<string, [number, number, number, number]>(), matches: [] as [string, number, number][] };
        d.games++; d.wins += r.w ? 1 : 0;
        const k = `${r.c}:${r.pc}`;
        const c = d.combos.get(k) ?? [r.c, r.pc, 0, 0];
        c[2]++; c[3] += r.w ? 1 : 0; d.combos.set(k, c);
        if (d.matches.length < 200) d.matches.push([r.id, r.pc, r.c]);
        by.set(r.p, d);
      }
      const duos: { key: string; games: number; wins: number; combos: number[][]; matches: [string, number, number][] }[] = [];
      for (const [p, d] of by) {
        duos.push({ key: await duoKey(player.puuid, p), games: d.games, wins: d.wins,
                    combos: [...d.combos.values()].sort((x, y) => y[2] - x[2]).slice(0, 10), matches: d.matches });
      }
      duos.sort((x, y) => y.games - x.games);
      return json({ duos }, 200, { "Cache-Control": "no-store" });
    }

    // Stats perso d'un joueur inscrit
    const m = /^\/v1\/players\/([^/]+)$/.exec(path);
    if (method === "GET" && m) {
      const client = decodeURIComponent(m[1]);
      if (!CLIENT_RE.test(client)) return error(400, "bad_client");
      const player = await env.DB.prepare(
        `SELECT p.puuid, p.ids_cursor, p.ids_refreshed_at, p.last_seen_at
         FROM devices d JOIN players p ON p.puuid = d.puuid WHERE d.client_hash = ?1`,
      ).bind(await sha256Hex(client)).first<{ puuid: string; ids_cursor: number | null; ids_refreshed_at: number | null; last_seen_at: number }>();
      if (!player) return error(404, "not_registered");
      const puuid = player.puuid;
      const [champs, matchups, counts, weekly] = await env.DB.batch([
        env.DB.prepare(
          `SELECT champion_id AS c, role AS r, COUNT(*) AS g, SUM(win) AS w FROM player_matches
           WHERE puuid = ?1 AND remake = 0 GROUP BY champion_id, role`).bind(puuid),
        env.DB.prepare(
          `SELECT champion_id AS c, role AS r, opponent_id AS o, COUNT(*) AS g, SUM(win) AS w FROM player_matches
           WHERE puuid = ?1 AND remake = 0 AND opponent_id IS NOT NULL GROUP BY champion_id, role, opponent_id`).bind(puuid),
        env.DB.prepare(
          `SELECT (SELECT COUNT(*) FROM player_matches WHERE puuid = ?1 AND remake = 0) AS matches,
                  (SELECT COUNT(*) FROM pending WHERE puuid = ?1) AS pending`).bind(puuid),
        // winrate par semaine (semaines du lundi au dimanche, en UTC) sur les 8 dernières semaines
        env.DB.prepare(
          `SELECT (game_creation - ${WEEK_OFFSET}) / ${WEEK} AS k, COUNT(*) AS g, SUM(win) AS w FROM player_matches
           WHERE puuid = ?1 AND remake = 0 AND game_creation >= ?2 GROUP BY k ORDER BY k`)
          .bind(puuid, weekStart(now) - 7 * WEEK),
      ]);
      if (now - player.last_seen_at > 3600_000) {
        await env.DB.prepare(`UPDATE players SET last_seen_at = ?2 WHERE puuid = ?1`).bind(puuid, now).run();
      }
      type Agg = { c: number; r: number; o?: number; g: number; w: number };
      const c = counts.results[0] as { matches: number; pending: number };
      return json({
        status: {
          matches: c.matches, pending: c.pending,
          syncing: c.pending > 0 || player.ids_cursor != null || player.ids_refreshed_at == null,
          lastSync: player.ids_refreshed_at,
        },
        champions: (champs.results as Agg[]).map((x) => [x.c, x.r, x.g, x.w]),
        matchups: (matchups.results as Agg[]).map((x) => [x.c, x.r, x.o, x.g, x.w]),
        weeks: (weekly.results as { k: number; g: number; w: number }[]).map((x) => [x.k * WEEK + WEEK_OFFSET, x.g, x.w]),
      }, 200, { "Cache-Control": "no-store" });
    }

    // Administration : liste et suppression des joueurs
    if (path === "/admin/players" && method === "GET") {
      if (!(await isAdmin(req, env))) return error(401, "unauthorized");
      const { results } = await env.DB.prepare(
        `SELECT p.puuid, p.created_at, p.last_seen_at,
                (SELECT COUNT(*) FROM player_matches m WHERE m.puuid = p.puuid) AS matches,
                (SELECT COUNT(*) FROM pending q WHERE q.puuid = p.puuid) AS pending
         FROM players p ORDER BY p.created_at`).all();
      return json({ players: results });
    }
    // Délier un compte de son appareil (inscription usurpée ou changement d'ordinateur) : ses stats restent.
    if (method === "POST" && path === "/admin/unlink") {
      if (!(await isAdmin(req, env))) return error(401, "unauthorized");
      let body: { riotId?: unknown };
      try { body = await req.json(); } catch { return error(400, "bad_json"); }
      const rid = typeof body.riotId === "string" ? RIOT_ID_RE.exec(body.riotId.trim()) : null;
      if (!rid) return error(400, "bad_riot_id");
      const acc = await new Riot(env.RIOT_API_KEY, env.RIOT_REGION || "europe", 1, fetcher).account(rid[1], rid[2]);
      if (!acc.ok) return acc.status === 404 ? error(404, "unknown_riot_id") : error(503, "riot_unavailable");
      const res = await env.DB.prepare(`DELETE FROM devices WHERE puuid = ?1`).bind(acc.data.puuid).run();
      return json({ ok: true, unlinked: (res.meta?.changes ?? 0) > 0 });
    }

    // Autoriser un appareil de plus pour un compte (un autre PC du même joueur) : 15 min, usage unique.
    if (method === "POST" && path === "/admin/allow-device") {
      if (!(await isAdmin(req, env))) return error(401, "unauthorized");
      let body: { riotId?: unknown };
      try { body = await req.json(); } catch { return error(400, "bad_json"); }
      const rid = typeof body.riotId === "string" ? RIOT_ID_RE.exec(body.riotId.trim()) : null;
      if (!rid) return error(400, "bad_riot_id");
      const acc = await new Riot(env.RIOT_API_KEY, env.RIOT_REGION || "europe", 1, fetcher).account(rid[1], rid[2]);
      if (!acc.ok) return acc.status === 404 ? error(404, "unknown_riot_id") : error(503, "riot_unavailable");
      const res = await env.DB.prepare(`UPDATE players SET device_window_until = ?2 WHERE puuid = ?1`)
        .bind(acc.data.puuid, now + DEVICE_WINDOW_MS).run();
      if ((res.meta?.changes ?? 0) === 0) return error(404, "not_registered");
      return json({ ok: true, minutes: DEVICE_WINDOW_MS / 60_000 });
    }

    const d = /^\/admin\/players\/([^/]+)$/.exec(path);
    if (d && method === "DELETE") {
      if (!(await isAdmin(req, env))) return error(401, "unauthorized");
      const puuid = decodeURIComponent(d[1]);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM pending WHERE puuid = ?1`).bind(puuid),
        env.DB.prepare(`DELETE FROM player_matches WHERE puuid = ?1`).bind(puuid),
        env.DB.prepare(`DELETE FROM devices WHERE puuid = ?1`).bind(puuid),
        env.DB.prepare(`DELETE FROM players WHERE puuid = ?1`).bind(puuid),
      ]);
      return json({ ok: true });
    }

    return error(404, "not_found");
  } catch (e) {
    console.error("Erreur", e instanceof Error ? e.message : e);
    return error(500, "server_error");
  }
}

/** Semaines du lundi 00:00 UTC (le 1er janvier 1970 était un jeudi : premier lundi le 5 janvier). */
const WEEK = 7 * 86400_000;
const WEEK_OFFSET = 4 * 86400_000;
const weekStart = (t: number) => Math.floor((t - WEEK_OFFSET) / WEEK) * WEEK + WEEK_OFFSET;

export default {
  fetch: (req: Request, env: Env) => handle(req, env),

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (!env.RIOT_API_KEY?.startsWith("RGAPI-")) return;
    const riot = new Riot(env.RIOT_API_KEY, env.RIOT_REGION || "europe", Number(env.RIOT_BUDGET_PER_RUN || 14));
    const seasonStart = Date.parse(`${env.SEASON_START || "2026-01-08"}T00:00:00Z`);
    ctx.waitUntil(
      syncRun(env.DB, riot, seasonStart, Date.now())
        .then((r) => { if (r.idCalls || r.matchCalls) console.log("Synchro", JSON.stringify(r)); })
        .catch((e) => console.error("Synchro en erreur", e instanceof Error ? e.message : e)),
    );
  },
};
