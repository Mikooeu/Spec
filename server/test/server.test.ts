import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle, trimSlashes, type Env } from "../src/index.ts";
import { Riot, type MatchDto } from "../src/riot.ts";
import { syncRun } from "../src/sync.ts";

// --- D1 et KV en mémoire, avec la même interface que Cloudflare -------------------------------
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init.sql", "0002_client_id.sql", "0003_devices.sql", "0004_match_detail.sql", "0005_match_index.sql", "0006_stats_fields.sql"]) {
    db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url).pathname, "utf8"));
  }
  class Stmt {
    constructor(private sql: string, private args: unknown[] = []) {}
    bind(...args: unknown[]) { return new Stmt(this.sql, args); }
    async all() { return { results: db.prepare(this.sql).all(...(this.args as never[])) }; }
    async first(col?: string) {
      const row = db.prepare(this.sql).get(...(this.args as never[])) as Record<string, unknown> | undefined;
      return row == null ? null : col ? row[col] : row;
    }
    async run() { const r = db.prepare(this.sql).run(...(this.args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; }
  }
  return {
    raw: db,
    prepare: (sql: string) => new Stmt(sql),
    batch: async (stmts: Stmt[]) => Promise.all(stmts.map((s) => s.all())),
  } as unknown as D1Database & { raw: DatabaseSync };
}

function fakeKV() {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    store,
    async put(k: string, value: string, opts?: { metadata?: unknown }) { store.set(k, { value, metadata: opts?.metadata }); },
    async getWithMetadata(k: string) { const e = store.get(k); return { value: e?.value ?? null, metadata: e?.metadata ?? null }; },
  } as unknown as KVNamespace;
}

const ADMIN = "a".repeat(48);
const P1 = "p".repeat(78);
const P2 = "q".repeat(78);
const BASE = "https://spec.test";

function env(): Env {
  return {
    DB: fakeD1(), STATS: fakeKV(), RIOT_API_KEY: "RGAPI-test", ADMIN_TOKEN: ADMIN, INVITE_CODE: "K7Q2-M9XD",
    RIOT_REGION: "europe", SEASON_START: "2026-01-08", MAX_PLAYERS: "2", RIOT_BUDGET_PER_RUN: "14",
  };
}

// Riot ID → PUUID de l'API (account-v1), comme chez Riot
const ACCOUNTS: Record<string, string> = { "MIKO/KCORP": P1, "Heavenly Sword/2822": P2, "Autre/EUW": "r".repeat(78) };
let riotCalls = 0;
const accountFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  riotCalls++;
  assert.equal((init?.headers as Record<string, string>)["X-Riot-Token"], "RGAPI-test");
  const m = /by-riot-id\/([^/]+)\/([^/]+)$/.exec(String(input));
  const puuid = m && ACCOUNTS[`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`];
  return puuid ? Response.json({ puuid, gameName: "x", tagLine: "y" }) : new Response("", { status: 404 });
}) as typeof fetch;

const call = (e: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(BASE + path, {
    method, headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }), e, 1_800_000_000_000, accountFetch);

// identifiants du client LoL (format UUID, différents des PUUID de l'API)
const C1 = "0a1b2c3d-1111-5222-9333-444455556666";
const C2 = "9f8e7d6c-1111-5222-9333-444455556666";
const reg = (e: Env, client: string, riotId: string, invite = "K7Q2-M9XD") =>
  call(e, "POST", "/v1/players", { client, riotId, invite });

function match(id: string, opts: { duration?: number; p1Champ?: number; p1Win?: boolean; withP2?: boolean;
  red?: boolean; surrender?: boolean; pentas?: number; created?: number } = {}): MatchDto {
  const mk = (puuid: string, championId: number, teamId: number, teamPosition: string, win: boolean) =>
    ({ puuid, championId, teamId, teamPosition, win, kills: 7, deaths: 2, assists: 9, totalMinionsKilled: 200,
       neutralMinionsKilled: 14, goldEarned: 12000, totalDamageDealtToChampions: 24310.4, item0: 3089, item1: 6655,
       item6: 3364, roleBoundItem: 3006, summoner1Id: 4, summoner2Id: 14,
       perks: { styles: [{ style: 8100, selections: [{ perk: 8112 }] }, { style: 8200 }] } });
  const parts = [
    { ...mk(P1, opts.p1Champ ?? 103, 100, "MIDDLE", opts.p1Win ?? true),
      gameEndedInSurrender: !!opts.surrender, pentaKills: opts.pentas ?? 0 },
    mk(opts.withP2 ? P2 : "x".repeat(78), 122, 100, "TOP", opts.p1Win ?? true),
    mk("y".repeat(78), 134, 200, "MIDDLE", !(opts.p1Win ?? true)),
    mk("z".repeat(78), 86, 200, "TOP", !(opts.p1Win ?? true)),
  ];
  // côté rouge : les deux équipes échangent leur teamId
  if (opts.red) for (const p of parts) p.teamId = p.teamId === 100 ? 200 : 100;
  return {
    metadata: { matchId: id, participants: parts.map((p) => p.puuid) },
    info: { queueId: 420, gameCreation: opts.created ?? 1_790_000_000_000, gameDuration: opts.duration ?? 1800, participants: parts },
  };
}

function riotFetch(ids: Record<string, string[]>, matches: Record<string, MatchDto>, log: string[], status429 = false) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    log.push(url);
    assert.equal((init?.headers as Record<string, string>)["X-Riot-Token"], "RGAPI-test");
    assert.ok(url.startsWith("https://europe.api.riotgames.com/"));
    if (status429) return new Response("", { status: 429, headers: { "Retry-After": "10" } });
    const byPuuid = /by-puuid\/([^/]+)\/ids\?(.*)$/.exec(url);
    if (byPuuid) {
      const q = new URLSearchParams(byPuuid[2]);
      assert.equal(q.get("queue"), "420");
      const all = ids[byPuuid[1]] ?? [];
      const start = Number(q.get("start"));
      return Response.json(all.slice(start, start + Number(q.get("count"))));
    }
    const m = /matches\/([^/?]+)$/.exec(url);
    if (m && matches[m[1]]) return Response.json(matches[m[1]]);
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

// --- Tests --------------------------------------------------------------------------------------
test("inscription : code d'invitation, Riot ID résolu par le serveur, plafond", async () => {
  const e = env();
  riotCalls = 0;
  assert.equal((await reg(e, C1, "MIKO#KCORP", "faux")).status, 403);
  assert.equal(riotCalls, 0);                                    // pas d'appel Riot sans bon code
  assert.equal((await reg(e, "court", "MIKO#KCORP")).status, 400);
  assert.equal((await reg(e, C1, "pas-de-tag")).status, 400);
  assert.equal((await reg(e, C1, "Inconnu#EUW")).status, 404);
  assert.equal((await reg(e, C1, "MIKO#KCORP", "k7q2-m9xd ")).status, 201);
  assert.equal((await reg(e, C1, "MIKO#KCORP", "")).status, 200);    // déjà inscrit
  assert.equal((await reg(e, C2, "Heavenly Sword#2822")).status, 201);
  assert.equal((await reg(e, "1a1b2c3d-1111-5222-9333-444455556666", "Autre#EUW")).status, 409);
  assert.equal((await call(e, "GET", "/v1/players/" + "1a1b2c3d-1111-5222-9333-444455556666")).status, 404);
  // la liste admin ne contient aucun pseudo
  const list = await (await call(e, "GET", "/admin/players", undefined, { Authorization: "Bearer " + ADMIN })).json() as { players: Record<string, unknown>[] };
  assert.ok(!JSON.stringify(list).includes("MIKO"));
});

test("la lecture des stats perso n'appelle jamais Riot", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  riotCalls = 0;
  const r = await call(e, "GET", "/v1/players/" + C1);
  assert.equal(r.status, 200);
  assert.equal(riotCalls, 0);
  const body = await r.json() as { status: { syncing: boolean; matches: number } };
  assert.equal(body.status.syncing, true);
  assert.equal(body.status.matches, 0);
});

test("synchro : historique, détail des parties, remakes exclus, vis-à-vis", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  await reg(e, C2, "Heavenly Sword#2822");
  const ids = { [P1]: ["EUW1_103", "EUW1_102", "EUW1_101", "EUW1_100"], [P2]: ["EUW1_103"] };
  const matches = {
    EUW1_103: match("EUW1_103", { withP2: true }),
    EUW1_102: match("EUW1_102", { p1Win: false }),
    EUW1_101: match("EUW1_101", { duration: 200 }),     // remake
  };                                                     // EUW1_100 : 404, ignorée
  const log: string[] = [];
  const riot = new Riot("RGAPI-test", "europe", 14, riotFetch(ids, matches, log));
  const report = await syncRun(e.DB, riot, Date.parse("2026-01-08T00:00:00Z"), 1_800_000_000_000);
  assert.equal(report.stopped, "done");
  assert.equal(report.idCalls, 2);
  assert.equal(report.matchCalls, 4);                   // EUW1_103 téléchargée une seule fois pour 2 amis
  assert.ok(log[0].includes("startTime=1767830400"));

  const r = await (await call(e, "GET", "/v1/players/" + C1)).json() as {
    status: { matches: number; pending: number; syncing: boolean };
    champions: number[][]; matchups: number[][];
  };
  assert.deepEqual(r.status, { matches: 2, pending: 0, syncing: false, lastSync: 1_800_000_000_000 } as never);
  assert.deepEqual(r.champions, [[103, 2, 2, 1]]);       // Ahri mid : 2 parties, 1 victoire
  assert.deepEqual(r.matchups, [[103, 2, 134, 2, 1]]);   // face à Syndra
  // winrate par semaine : lundi UTC, 8 dernières semaines seulement
  const weeks = (r as unknown as { weeks: number[][] }).weeks;
  assert.ok(Array.isArray(weeks));
  for (const [start] of weeks) assert.equal(new Date(start).getUTCDay(), 1);
  const r2 = await (await call(e, "GET", "/v1/players/" + C2)).json() as { champions: number[][] };
  assert.deepEqual(r2.champions, [[122, 0, 1, 1]]);

  // historique détaillé : du plus récent au plus ancien, sans pseudo, et sans appel Riot
  riotCalls = 0;
  const hist = await (await call(e, "GET", "/v1/players/" + C1 + "/matches?limit=10")).json() as { matches: unknown[][] };
  assert.equal(riotCalls, 0);
  assert.equal(hist.matches.length, 3);                  // remake compris (marqué), 404 exclue
  const first = hist.matches.find((m) => m[0] === "EUW1_103")!;
  assert.deepEqual(first.slice(2, 7), [103, 2, 134, 1, 0]);
  assert.deepEqual(first[7], [1800, 7, 2, 9, 214, 12000, 24310, [3089, 6655, 0, 0, 0, 0, 3364, 3006], [4, 14], 8112, 8200, 0, 0, 0]);
  assert.ok(!JSON.stringify(hist).includes("p".repeat(78)));
  assert.equal((await call(e, "GET", "/v1/players/" + "1a1b2c3d-1111-5222-9333-444455556666" + "/matches")).status, 404);

  // duo : EUW1_103 jouée avec P2 dans la même équipe ; aucun PUUID ni pseudo renvoyé
  const duo = await (await call(e, "GET", "/v1/players/" + C1 + "/duos")).json() as
    { duos: { key: string; games: number; wins: number; combos: number[][]; matches: unknown[][] }[] };
  assert.equal(duo.duos.length, 1);
  assert.deepEqual([duo.duos[0].games, duo.duos[0].wins], [1, 1]);
  assert.deepEqual(duo.duos[0].combos, [[103, 122, 1, 1]]);
  assert.deepEqual(duo.duos[0].matches, [["EUW1_103", 122, 103]]);
  assert.match(duo.duos[0].key, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(duo).includes("q".repeat(78)));
  const together = await (await call(e, "GET", `/v1/players/${C1}/matches?with=${duo.duos[0].key}`)).json() as { matches: unknown[][] };
  assert.deepEqual(together.matches.map((m) => m[0]), ["EUW1_103"]);
  const nobody = await (await call(e, "GET", `/v1/players/${C1}/matches?with=0123456789abcdef`)).json() as { matches: unknown[] };
  assert.equal(nobody.matches.length, 0);
  // la clé du duo est propre à chaque joueur
  const duo2 = await (await call(e, "GET", "/v1/players/" + C2 + "/duos")).json() as { duos: { key: string }[] };
  assert.notEqual(duo2.duos[0].key, duo.duos[0].key);

  // second passage : rien de nouveau, aucun appel
  log.length = 0;
  const again = await syncRun(e.DB, new Riot("RGAPI-test", "europe", 14, riotFetch(ids, matches, log)),
    Date.parse("2026-01-08T00:00:00Z"), 1_800_000_000_000 + 60_000);
  assert.equal(again.idCalls + again.matchCalls, 0);
});

test("synchro : budget respecté, reprise de l'historique, arrêt sur 429", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  const many = Array.from({ length: 250 }, (_, i) => `EUW1_${7400001000 - i}`);   // vrais ids : même longueur
  const matches = Object.fromEntries(many.map((id) => [id, match(id)]));
  const log: string[] = [];
  const r1 = await syncRun(e.DB, new Riot("RGAPI-test", "europe", 5, riotFetch({ [P1]: many }, matches, log)), 0, 1_800_000_000_000);
  assert.equal(log.length, 5);
  assert.equal(r1.idCalls, 3);                            // 250 parties = 3 pages
  assert.equal(r1.matchCalls, 2);
  assert.ok(log[3].endsWith("EUW1_7400001000"));             // les plus récentes d'abord
  const pending = e.DB as unknown as { raw: DatabaseSync };
  assert.equal((pending.raw.prepare("SELECT COUNT(*) AS n FROM pending").get() as { n: number }).n, 248);

  const r2 = await syncRun(e.DB, new Riot("RGAPI-test", "europe", 14, riotFetch({}, {}, [], true)), 0, 1_800_000_000_000 + 60_000);
  assert.equal(r2.stopped, "rate_limited");
  assert.equal(r2.matchCalls, 1);
});

test("stats Master+ : envoi protégé par jeton, lecture avec ETag", async () => {
  const e = env();
  const stats = JSON.stringify({ meta: { patch: "16.21" }, champions: [], base: [] });
  assert.equal((await call(e, "PUT", "/admin/stats", stats)).status, 401);
  assert.equal((await call(e, "PUT", "/admin/stats", stats, { Authorization: "Bearer " + "b".repeat(48) })).status, 401);
  assert.equal((await call(e, "GET", "/v1/stats")).status, 404);
  assert.equal((await call(e, "PUT", "/admin/stats", "{}", { Authorization: "Bearer " + ADMIN })).status, 400);
  const ok = await call(e, "PUT", "/admin/stats", stats, { Authorization: "Bearer " + ADMIN });
  assert.equal(ok.status, 200);
  const got = await call(e, "GET", "/v1/stats");
  assert.equal(await got.text(), stats);
  assert.equal(got.headers.get("Access-Control-Allow-Origin"), "*");
  const etag = got.headers.get("ETag")!;
  assert.equal((await call(e, "GET", "/v1/stats", undefined, { "If-None-Match": etag })).status, 304);
  // une version par région ; l'EUW reste la valeur par défaut
  const kr = JSON.stringify({ meta: { patch: "16.22" }, champions: [], base: [] });
  assert.equal((await call(e, "PUT", "/admin/stats?region=kr", kr, { Authorization: "Bearer " + ADMIN })).status, 200);
  assert.equal(await (await call(e, "GET", "/v1/stats?region=kr")).text(), kr);
  assert.equal(await (await call(e, "GET", "/v1/stats?region=euw")).text(), stats);
  assert.equal((await call(e, "GET", "/v1/stats?region=world")).status, 404);
  assert.equal((await call(e, "GET", "/v1/stats?region=mars")).status, 400);
  assert.equal((await call(e, "PUT", "/admin/stats?region=mars", kr, { Authorization: "Bearer " + ADMIN })).status, 400);
});

test("administration : jeton requis pour lister et supprimer", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  assert.equal((await call(e, "GET", "/admin/players")).status, 401);
  const list = await (await call(e, "GET", "/admin/players", undefined, { Authorization: "Bearer " + ADMIN })).json() as { players: unknown[] };
  assert.equal(list.players.length, 1);
  assert.equal((await call(e, "DELETE", "/admin/players/" + P1)).status, 401);
  assert.equal((await call(e, "DELETE", "/admin/players/" + P1, undefined, { Authorization: "Bearer " + ADMIN })).status, 200);
  assert.equal((await call(e, "GET", "/v1/players/" + C1)).status, 404);
});

test("fetch est appelé sans objet devant (sinon « Illegal invocation » chez Cloudflare)", async () => {
  const original = globalThis.fetch;
  let seenThis: unknown = "pas appelé";
  // comme le fetch de Cloudflare : refuse d'être appelé comme méthode d'un autre objet
  globalThis.fetch = function (this: unknown) {
    seenThis = this;
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(Response.json({ puuid: P1 }));
  } as typeof fetch;
  try {
    const e = env();
    const r = await handle(new Request(BASE + "/v1/players", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: C1, riotId: "MIKO#KCORP", invite: "K7Q2-M9XD" }),
    }), e, 1_800_000_000_000);
    assert.equal(r.status, 201);
    assert.notEqual(seenThis, "pas appelé");
    const ids = await new Riot("RGAPI-test", "europe", 1).matchIds(P1, 0, 0);
    assert.equal(ids.ok, true);
  } finally { globalThis.fetch = original; }
});

const C3 = "5e5e5e5e-1111-5222-9333-444455556666";

test("un compte déjà lié n'est jamais réattribué à un autre appareil", async () => {
  const e = env();
  assert.equal((await reg(e, C1, "MIKO#KCORP")).status, 201);
  const steal = await reg(e, C3, "MIKO#KCORP");                    // même code, autre appareil
  assert.equal(steal.status, 409);
  assert.deepEqual(await steal.json(), { error: "already_linked" });
  assert.equal((await call(e, "GET", "/v1/players/" + C3)).status, 404);
  assert.equal((await call(e, "GET", "/v1/players/" + C1)).status, 200);
  assert.equal((await reg(e, C1, "MIKO#KCORP", "")).status, 200);  // le vrai propriétaire reste reconnu
});

test("inscription usurpée : l'admin délie le compte, le vrai joueur peut s'inscrire", async () => {
  const e = env();
  assert.equal((await reg(e, C3, "Heavenly Sword#2822")).status, 201);   // quelqu'un s'inscrit à la place de l'ami
  assert.equal((await reg(e, C2, "Heavenly Sword#2822")).status, 409);
  const unlink = (auth?: string) => call(e, "POST", "/admin/unlink", { riotId: "Heavenly Sword#2822" },
    auth ? { Authorization: auth } : {});
  assert.equal((await unlink()).status, 401);
  assert.equal((await unlink("Bearer " + "b".repeat(48))).status, 401);
  const ok = await unlink("Bearer " + ADMIN);
  assert.deepEqual(await ok.json(), { ok: true, unlinked: true });
  assert.equal((await reg(e, C2, "Heavenly Sword#2822")).status, 201);
  assert.equal((await call(e, "GET", "/v1/players/" + C3)).status, 404);
  assert.equal((await call(e, "GET", "/v1/players/" + C2)).status, 200);
});

test("chemins : « / » finaux retirés en temps linéaire, chemins trop longs refusés", async () => {
  assert.equal(trimSlashes("/v1/health///"), "/v1/health");
  assert.equal(trimSlashes("///"), "/");
  assert.equal(trimSlashes("/"), "/");
  const t = performance.now();
  trimSlashes("/" + "/".repeat(200_000) + "x");
  trimSlashes("/" + "/".repeat(200_000));
  assert.ok(performance.now() - t < 50);
  const e = env();
  assert.equal((await call(e, "GET", "/v1/health//")).status, 200);
  assert.equal((await call(e, "GET", "/" + "/".repeat(5000) + "x")).status, 414);
});

test("un deuxième PC pour le même compte : refusé, sauf fenêtre ouverte par l'admin (usage unique)", async () => {
  const e = env();
  const C4 = "7a7a7a7a-1111-5222-9333-444455556666";
  assert.equal((await reg(e, C1, "MIKO#KCORP")).status, 201);
  assert.equal((await reg(e, C3, "MIKO#KCORP")).status, 409);
  const allow = (auth?: string) => call(e, "POST", "/admin/allow-device", { riotId: "MIKO#KCORP" },
    auth ? { Authorization: auth } : {});
  assert.equal((await allow()).status, 401);
  assert.equal((await allow("Bearer " + ADMIN)).status, 200);
  assert.equal((await reg(e, C3, "MIKO#KCORP")).status, 201);     // le 2e PC est accepté
  assert.equal((await call(e, "GET", "/v1/players/" + C1)).status, 200);
  assert.equal((await call(e, "GET", "/v1/players/" + C3)).status, 200);
  assert.equal((await reg(e, C4, "MIKO#KCORP")).status, 409);     // fenêtre consommée
  // fenêtre expirée : refusée
  await allow("Bearer " + ADMIN);
  const late = await handle(new Request(BASE + "/v1/players", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: C4, riotId: "MIKO#KCORP", invite: "K7Q2-M9XD" }),
  }), e, 1_800_000_000_000 + 16 * 60_000, accountFetch);
  assert.equal(late.status, 409);
  // délier retire tous les appareils
  await call(e, "POST", "/admin/unlink", { riotId: "MIKO#KCORP" }, { Authorization: "Bearer " + ADMIN });
  assert.equal((await call(e, "GET", "/v1/players/" + C1)).status, 404);
  assert.equal((await call(e, "GET", "/v1/players/" + C3)).status, 404);
});

test("migration : les liens existants deviennent des appareils", async () => {
  const db = new DatabaseSync(":memory:");
  const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url).pathname, "utf8");
  db.exec(sql("0001_init.sql"));
  db.exec(sql("0002_client_id.sql"));
  db.prepare("INSERT INTO players (puuid, created_at, last_seen_at, client_hash) VALUES (?, 1, 1, ?)").run(P1, "h1");
  db.exec(sql("0003_devices.sql"));
  assert.deepEqual({ ...db.prepare("SELECT client_hash, puuid FROM devices").get() as object }, { client_hash: "h1", puuid: P1 });
});

test("page Stats : totaux par champion, côté, abandon, durée et jour (fuseau du joueur), sans appel Riot", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  // lundi 2 novembre 2026 à 23 h 30 UTC = mardi 0 h 30 à Paris (UTC+1)
  const monLate = Date.parse("2026-11-02T23:30:00Z");
  const ids = { [P1]: ["EUW1_4", "EUW1_3", "EUW1_2", "EUW1_1"] };
  const matches = {
    EUW1_4: match("EUW1_4", { red: true, surrender: true, p1Win: true, duration: 1500, pentas: 1, created: monLate }),
    EUW1_3: match("EUW1_3", { red: true, p1Win: false, duration: 2100, created: monLate }),
    EUW1_2: match("EUW1_2", { p1Win: true, duration: 1700, created: monLate }),
    EUW1_1: match("EUW1_1", { duration: 200, created: monLate }),   // remake : exclu
  };
  await syncRun(e.DB, new Riot("RGAPI-test", "europe", 14, riotFetch(ids, matches, [])),
    Date.parse("2026-01-08T00:00:00Z"), 1_800_000_000_000);
  riotCalls = 0;
  const r = await (await call(e, "GET", `/v1/players/${C1}/stats?tz=60`)).json() as {
    champions: number[][]; sides: number[][]; surrender: { known: number; games: number; wins: number };
    duration: number[][]; days: number[][];
  };
  assert.equal(riotCalls, 0);
  // Ahri mid : 3 parties, 2 victoires, K/D/A, CS, or et durée additionnés, 1 pentakill
  assert.deepEqual(r.champions, [[103, 2, 3, 2, 21, 6, 27, 642, 36000, 5300, 1]]);
  assert.deepEqual(r.sides, [[1, 1], [2, 1]]);                 // bleu 1/1, rouge 1/2
  assert.deepEqual(r.surrender, { known: 3, games: 1, wins: 1 });
  assert.deepEqual(r.duration, [[2, 2], [1, 0]]);               // < 30 min : 2/2, ≥ 30 min : 0/1
  assert.deepEqual(r.days[1], [3, 2]);                          // mardi à Paris
  assert.deepEqual(r.days[0], [0, 0]);
  const utc = await (await call(e, "GET", `/v1/players/${C1}/stats?tz=0`)).json() as { days: number[][] };
  assert.deepEqual(utc.days[0], [3, 2]);                        // lundi en UTC
  assert.equal((await call(e, "GET", `/v1/players/${C1}/stats?tz=9999`)).status, 400);
  assert.equal((await call(e, "GET", `/v1/players/1a1b2c3d-1111-5222-9333-444455556666/stats`)).status, 404);
});

test("migration 0006 : les parties d'avant la 0.5 sont remises en file pour être relues", async () => {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init.sql", "0002_client_id.sql", "0003_devices.sql", "0004_match_detail.sql", "0005_match_index.sql"]) {
    db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url).pathname, "utf8"));
  }
  db.exec(`DELETE FROM pending`);
  const ins = db.prepare(`INSERT INTO player_matches (puuid, match_id, game_creation, champion_id, role, win, remake, detail)
                          VALUES (?, ?, 1, 103, 2, 1, 0, ?)`);
  ins.run(P1, "EUW1_OLD", JSON.stringify([1800, 1, 1, 1, 1, 1, 1, [], [], 0, 0]));
  ins.run(P1, "EUW1_NEW", JSON.stringify([1800, 1, 1, 1, 1, 1, 1, [], [], 0, 0, 1, 0, 0]));
  db.exec(readFileSync(new URL("../migrations/0006_stats_fields.sql", import.meta.url).pathname, "utf8"));
  assert.deepEqual(db.prepare(`SELECT match_id FROM pending`).all().map((x) => (x as { match_id: string }).match_id), ["EUW1_OLD"]);
});

test("runes de la partie en cours : inscrits seulement, spectator sur la plateforme, aucun PUUID renvoyé", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  const urls: string[] = [];
  const spect = (async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url);
    if (url.includes("/spectator/v5/active-games/by-summoner/")) return Response.json({ participants: [
      { puuid: P1, riotId: "MIKO#KCORP", championId: 103, teamId: 100, perks: { perkIds: [8112, 8126], perkStyle: 8100, perkSubStyle: 8200 } },
      { puuid: P2, riotId: "Autre#EUW", championId: 122, teamId: 200, perks: { perkIds: [8010], perkStyle: 8000, perkSubStyle: 8400 } },
    ] });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const get = (client: string) => handle(new Request(`${BASE}/v1/players/${client}/live`), e, 1_800_000_000_000, spect);
  assert.equal((await get(C2)).status, 404);
  assert.equal(urls.length, 0);                                  // pas d'appel Riot pour un appareil inconnu
  const r = await get(C1);
  assert.equal(r.status, 200);
  assert.ok(urls[0].startsWith("https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/"));
  const text = await r.text();
  assert.deepEqual(JSON.parse(text), { runes: [[103, 100, 8112, 8200], [122, 200, 8010, 8400]] });
  assert.ok(!text.includes(P1) && !text.includes("MIKO"));
});

test("suppression par le joueur : tout part, seul l'appareil lié peut la demander", async () => {
  const e = env();
  assert.equal((await reg(e, C1, "MIKO#KCORP", "K7Q2-M9XD")).status, 201);
  assert.equal((await reg(e, C2, "Heavenly Sword#2822", "K7Q2-M9XD")).status, 201);
  assert.equal((await call(e, "DELETE", "/v1/players/court")).status, 400);
  assert.equal((await call(e, "DELETE", "/v1/players/" + "1a1b2c3d-1111-5222-9333-444455556666")).status, 404);
  assert.equal((await call(e, "DELETE", "/v1/players/" + C1)).status, 200);
  assert.equal((await call(e, "GET", "/v1/players/" + C1)).status, 404);
  const db = (e.DB as unknown as { raw: DatabaseSync }).raw;
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM players WHERE puuid = ?`).get(P1) as { n: number }).n, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM devices WHERE puuid = ?`).get(P1) as { n: number }).n, 0);
  // l'autre joueur n'est pas touché, et le compte supprimé peut se réinscrire
  assert.equal((await call(e, "GET", "/v1/players/" + C2)).status, 200);
  assert.equal((await reg(e, C1, "MIKO#KCORP", "K7Q2-M9XD")).status, 201);
});
