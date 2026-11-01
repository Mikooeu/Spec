// Prépare Spec pour les versions installables et les mises à jour automatiques.
// Usage (dans le dossier app) :
//   node scripts/configure-release.mjs            configure une fois (après la publication sur GitHub)
//   node scripts/configure-release.mjs 0.2.0      change le numéro de version avant une nouvelle sortie
//
// Lit le dépôt GitHub (git remote) et la clé publique de signature (~/.tauri/spec.key.pub).
// La clé privée n'est jamais lue ici : elle va uniquement dans les secrets GitHub.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONF = "src-tauri/tauri.conf.json";
const PKG = "package.json";
const PUBKEY = join(homedir(), ".tauri", "spec.key.pub");
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const version = process.argv[2];
if (version && !/^\d+\.\d+\.\d+$/.test(version)) fail(`Version invalide : ${version} (format attendu : 0.2.0).`);

// adresse du dépôt lue dans ../.git/config (pas besoin de la commande git, GitHub Desktop suffit)
let remote = "";
const gitConfig = join("..", ".git", "config");
if (existsSync(gitConfig)) {
  remote = readFileSync(gitConfig, "utf8").match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1] ?? "";
}
const repo = remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1];
if (!repo) fail("Dépôt GitHub introuvable : publie d'abord le dossier Spec avec GitHub Desktop.");
if (!existsSync(PUBKEY)) fail(`Clé de signature introuvable (${PUBKEY}) : lance d'abord npx tauri signer generate -w ~/.tauri/spec.key`);
const pubkey = readFileSync(PUBKEY, "utf8").trim();

const conf = JSON.parse(readFileSync(CONF, "utf8"));
if (version) conf.version = version;
conf.bundle ??= {};
conf.bundle.active = true;
conf.bundle.targets = ["nsis", "app", "dmg"];
conf.bundle.createUpdaterArtifacts = true;
conf.bundle.publisher = "Spec";
conf.bundle.shortDescription = "Recommandations de pick pendant la sélection des champions";
conf.bundle.windows = {
  ...(conf.bundle.windows ?? {}),
  nsis: {
    installMode: "currentUser",
    // habillage aux couleurs de Spec
    installerIcon: "icons/icon.ico",
    headerImage: "installer/header.bmp",
    sidebarImage: "installer/sidebar.bmp",
    languages: ["French"],
    displayLanguageSelector: false,
  },
};
conf.plugins ??= {};
conf.plugins.updater = {
  pubkey,
  endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
  windows: { installMode: "passive" },
};
writeFileSync(CONF, JSON.stringify(conf, null, 2) + "\n");

if (version) {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  pkg.version = version;
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
}
console.log(`✓ Spec ${conf.version} · mises à jour depuis github.com/${repo}`);
