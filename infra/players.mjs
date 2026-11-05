#!/usr/bin/env node
// Spec : liste les comptes liés avec leur pseudo Riot, dans ton Terminal uniquement.
//
// Lancement (depuis le dossier Spec, sur le Mac) :   node infra/players.mjs
//
// Les identifiants viennent de la base D1 (via Wrangler, connecté à ton compte Cloudflare) ; les pseudos sont
// demandés à Riot avec la clé du fichier .env, au moment où tu lances le script. Rien n'est enregistré :
// le serveur Spec continue de ne stocker aucun pseudo.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const key = env.RIOT_API_KEY;
if (!key || key.includes("xxxx")) { console.error("Clé Riot introuvable dans .env (RIOT_API_KEY)."); process.exit(1); }
const cluster = env.RIOT_REGION || "europe";   // le service des comptes répond pour tous les serveurs

const sql = `SELECT p.puuid, p.created_at, p.last_seen_at,
  (SELECT COUNT(*) FROM player_matches m WHERE m.puuid = p.puuid) AS games,
  (SELECT COUNT(*) FROM pending q WHERE q.puuid = p.puuid) AS pending,
  (SELECT COUNT(*) FROM devices d WHERE d.puuid = p.puuid) AS pcs
  FROM players p ORDER BY p.last_seen_at DESC`;
let rows;
try {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "spec", "--remote", "--json", "--command", sql.replace(/\s+/g, " ")],
    { cwd: "server", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  rows = JSON.parse(out)[0].results;
} catch (e) {
  console.error("Lecture de la base impossible. Si l’erreur parle de « 7403 », lance d’abord : cd server && npx wrangler login");
  console.error(String(e.stderr || e.message).trim().split("\n").slice(-3).join("\n"));
  process.exit(1);
}

const date = (ms) => new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const out = [];
for (const r of rows) {
  let name = "?";
  try {
    const res = await fetch(`https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${r.puuid}`,
      { headers: { "X-Riot-Token": key } });
    if (res.ok) { const a = await res.json(); name = `${a.gameName}#${a.tagLine}`; }
    else name = res.status === 403 ? "(clé Riot expirée)" : `(Riot : erreur ${res.status})`;
  } catch { name = "(Riot injoignable)"; }
  out.push({ Pseudo: name, "Lié le": date(r.created_at), "Vu le": date(r.last_seen_at),
             Parties: r.games, "En attente": r.pending, PC: r.pcs });
}
console.log(`\n${rows.length} compte${rows.length > 1 ? "s" : ""} lié${rows.length > 1 ? "s" : ""} à Spec :\n`);
console.table(out);
