// Installation du serveur Spec sur Cloudflare, en une commande : `npm run setup` (dans server/).
// Prérequis : `npx wrangler login` fait une fois, et la clé Riot dans ../.env.
//
// Le script crée la base D1 et l'espace KV, applique le schéma, déploie le Worker,
// enregistre les secrets (clé Riot, jeton admin, code d'invitation) et écrit l'adresse
// du serveur dans ../.env et ../app/.env.local. Il peut être relancé sans risque.
// Aucun secret n'est affiché, sauf le code d'invitation (fait pour être partagé avec tes amis).

import { spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..");
const ROOT = join(SERVER, "..");
const ENV_FILE = join(ROOT, ".env");
const APP_ENV = join(ROOT, "app", ".env.local");
const TOML = join(SERVER, "wrangler.toml");
const DB_NAME = "spec";
const KV_NAME = "spec-stats";

const step = (msg) => console.log(`\n→ ${msg}`);
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

function wrangler(args, { cwd = SERVER, input, quiet = false } = {}) {
  const bin = join(SERVER, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  if (!existsSync(bin)) fail("Wrangler n'est pas installé : lance d'abord `npm install` dans le dossier server.");
  const res = spawnSync(bin, args, {
    cwd, input, encoding: "utf8", stdio: [input ? "pipe" : "ignore", "pipe", "pipe"], shell: process.platform === "win32",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", FORCE_COLOR: "0" },
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (!quiet && res.status !== 0) console.error(out.trim());
  return { ok: res.status === 0, out };
}

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
}

function setEnv(file, values) {
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text}${text.endsWith("\n") || !text ? "" : "\n"}${k}=${v}\n`;
  }
  writeFileSync(file, text, { mode: 0o600 });
}

function inviteCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("");
  return `${pick()}-${pick()}`;
}

// 0. Prérequis ---------------------------------------------------------------------------------
const env = readEnv(ENV_FILE);
const riotKey = (env.RIOT_API_KEY ?? "").trim();
if (!riotKey.startsWith("RGAPI-") || riotKey.includes("xxxx")) fail("Clé Riot introuvable dans le fichier .env du dossier Spec.");

step("Connexion à Cloudflare");
const who = wrangler(["whoami"], { quiet: true });
if (!who.ok || /not authenticated|You are not/i.test(who.out)) fail("Pas connecté : lance d'abord `npx wrangler login`.");
console.log("  connecté");

// 1. Base D1 et espace KV ------------------------------------------------------------------------
const tmp = tmpdir(); // création hors du dossier : Wrangler ne touche pas à wrangler.toml
step("Base de données D1");
let dbs = JSON.parse(wrangler(["d1", "list", "--json"], { cwd: tmp }).out.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
if (!dbs.some((d) => d.name === DB_NAME)) {
  if (!wrangler(["d1", "create", DB_NAME, "--location", "weur"], { cwd: tmp }).ok) fail("Création de la base impossible.");
  dbs = JSON.parse(wrangler(["d1", "list", "--json"], { cwd: tmp }).out.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
}
const dbId = dbs.find((d) => d.name === DB_NAME)?.uuid;
if (!dbId) fail("Base introuvable après création.");
console.log("  prête");

step("Espace KV pour les stats Master+");
const listKv = () => JSON.parse(wrangler(["kv", "namespace", "list"], { cwd: tmp }).out.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
let kvs = listKv();
if (!kvs.some((k) => k.title === KV_NAME)) {
  if (!wrangler(["kv", "namespace", "create", KV_NAME], { cwd: tmp }).ok) fail("Création de l'espace KV impossible.");
  kvs = listKv();
}
const kvId = kvs.find((k) => k.title === KV_NAME)?.id;
if (!kvId) fail("Espace KV introuvable après création.");
console.log("  prêt");

let toml = readFileSync(TOML, "utf8");
toml = toml.replace(/database_id = ".*"/, `database_id = "${dbId}"`)
           .replace(/(\[\[kv_namespaces\]\][^\[]*?id = )".*"/, `$1"${kvId}"`);
writeFileSync(TOML, toml);

// 2. Schéma ------------------------------------------------------------------------------------
step("Schéma de la base");
if (!wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"]).ok) fail("Application du schéma impossible.");
console.log("  à jour");

// 3. Déploiement -------------------------------------------------------------------------------
step("Déploiement du serveur");
const dep = wrangler(["deploy"]);
if (!dep.ok) {
  if (/workers\.dev subdomain/i.test(dep.out)) {
    fail("Choisis d'abord ton sous-domaine workers.dev : tableau de bord Cloudflare → Workers & Pages, puis relance.");
  }
  fail("Déploiement impossible.");
}
const url = dep.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
if (!url) fail("Adresse du serveur introuvable dans la sortie de Wrangler.");
console.log(`  en ligne : ${url}`);

// 4. Secrets -----------------------------------------------------------------------------------
step("Secrets du serveur");
const adminToken = env.SPEC_ADMIN_TOKEN?.length >= 32 ? env.SPEC_ADMIN_TOKEN : randomBytes(32).toString("hex");
const invite = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(env.SPEC_INVITE_CODE ?? "") ? env.SPEC_INVITE_CODE : inviteCode();
for (const [name, value] of [["RIOT_API_KEY", riotKey], ["ADMIN_TOKEN", adminToken], ["INVITE_CODE", invite]]) {
  if (!wrangler(["secret", "put", name], { input: value, quiet: true }).ok) fail(`Enregistrement du secret ${name} impossible.`);
  console.log(`  ${name} enregistré`);
}

setEnv(ENV_FILE, { SPEC_API_URL: url, SPEC_ADMIN_TOKEN: adminToken, SPEC_INVITE_CODE: invite });
setEnv(APP_ENV, { VITE_SPEC_API_URL: url });

// 5. Vérification ------------------------------------------------------------------------------
step("Vérification");
const health = await fetch(`${url}/v1/health`).then((r) => r.ok).catch(() => false);
console.log(health ? "  le serveur répond" : "  le serveur ne répond pas encore (patiente une minute)");

console.log(`
✓ Serveur Spec prêt : ${url}
  Code d'invitation pour tes amis : ${invite}
  (aussi rangé dans .env, ligne SPEC_INVITE_CODE)

Suite : python -m scoring export --upload   pour publier les stats Master+.`);
