// Administration du serveur Spec, depuis le dossier server :
//   npm run admin -- list                     joueurs inscrits (sans pseudo) et avancement de la synchro
//   npm run admin -- unlink "Nom#TAG"         délie un compte de son appareil (ses stats restent)
// Lit SPEC_API_URL et SPEC_ADMIN_TOKEN dans le .env du dossier Spec. Le jeton n'est jamais affiché.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
const env = existsSync(ENV_FILE) ? Object.fromEntries(readFileSync(ENV_FILE, "utf8").split("\n")
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])) : {};
const url = (env.SPEC_API_URL ?? "").replace(/\/+$/, "");
const token = env.SPEC_ADMIN_TOKEN ?? "";
if (!url.startsWith("https://") || token.length < 32) {
  console.error("SPEC_API_URL ou SPEC_ADMIN_TOKEN manquant dans .env : lance d'abord `npm run setup`.");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const [cmd, arg] = process.argv.slice(2);

if (cmd === "list") {
  const r = await fetch(`${url}/admin/players`, { headers });
  if (!r.ok) { console.error(`Refusé (HTTP ${r.status}).`); process.exit(1); }
  const { players } = await r.json();
  console.log(`${players.length} joueur(s) inscrit(s)`);
  for (const p of players) {
    const since = new Date(p.created_at).toLocaleDateString("fr-FR");
    console.log(`  ${p.puuid.slice(0, 8)}…  inscrit le ${since} · ${p.matches} parties analysées · ${p.pending} en attente`);
  }
} else if (cmd === "unlink" && arg) {
  const r = await fetch(`${url}/admin/unlink`, { method: "POST", headers, body: JSON.stringify({ riotId: arg }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`Refusé (HTTP ${r.status}${body.error ? `, ${body.error}` : ""}).`); process.exit(1); }
  console.log(body.unlinked ? `${arg} est délié : son propriétaire peut s'inscrire à nouveau depuis Spec.`
                            : `${arg} n'était lié à aucun appareil.`);
} else {
  console.log('Usage : npm run admin -- list  |  npm run admin -- unlink "Nom#TAG"');
}
