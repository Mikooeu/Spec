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
  for (const f of ["0001_init.sql", "0002_client_id.sql"]) {
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

function match(id: string, opts: { duration?: number; p1Champ?: number; p1Win?: boolean; withP2?: boolean } = {}): MatchDto {
  const mk = (puuid: string, championId: number, teamId: number, teamPosition: string, win: boolean) =>
    ({ puuid, championId, teamId, teamPosition, win });
  const parts = [
    mk(P1, opts.p1Champ ?? 103, 100, "MIDDLE", opts.p1Win ?? true),
    mk(opts.withP2 ? P2 : "x".repeat(78), 122, 100, "TOP", opts.p1Win ?? true),
    mk("y".repeat(78), 134, 200, "MIDDLE", !(opts.p1Win ?? true)),
    mk("z".repeat(78), 86, 200, "TOP", !(opts.p1Win ?? true)),
  ];
  return {
    metadata: { matchId: id, participants: parts.map((p) => p.puuid) },
    info: { queueId: 420, gameCreation: 1_790_000_000_000, gameDuration: opts.duration ?? 1800, participants: parts },
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
  const r2 = await (await call(e, "GET", "/v1/players/" + C2)).json() as { champions: number[][] };
  assert.deepEqual(r2.champions, [[122, 0, 1, 1]]);

  // second passage : rien de nouveau, aucun appel
  log.length = 0;
  const again = await syncRun(e.DB, new Riot("RGAPI-test", "europe", 14, riotFetch(ids, matches, log)),
    Date.parse("2026-01-08T00:00:00Z"), 1_800_000_000_000 + 60_000);
  assert.equal(again.idCalls + again.matchCalls, 0);
});

test("synchro : budget respecté, reprise de l'historique, arrêt sur 429", async () => {
  const e = env();
  await reg(e, C1, "MIKO#KCORP");
  const many = Array.from({ length: 250 }, (_, i) => `EUW1_${1000 - i}`);
  const matches = Object.fromEntries(many.map((id) => [id, match(id)]));
  const log: string[] = [];
  const r1 = await syncRun(e.DB, new Riot("RGAPI-test", "europe", 5, riotFetch({ [P1]: many }, matches, log)), 0, 1_800_000_000_000);
  assert.equal(log.length, 5);
  assert.equal(r1.idCalls, 3);                            // 250 parties = 3 pages
  assert.equal(r1.matchCalls, 2);
  assert.ok(log[3].endsWith("EUW1_1000"));               // les plus récentes d'abord
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
