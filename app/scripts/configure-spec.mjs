// Configure la fenêtre Tauri pour Spec : nom, identifiant, taille.
// Usage (dans le dossier app) : node scripts/configure-spec.mjs
import { readFileSync, writeFileSync } from "node:fs";

const path = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(path, "utf8"));
conf.productName = "Spec";
conf.identifier = "com.spec.app";
conf.app ??= {};
conf.app.windows ??= [{}];
Object.assign(conf.app.windows[0], {
  title: "Spec", width: 1280, height: 800, minWidth: 1280, minHeight: 800, center: true,
});
writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
console.log("tauri.conf.json mis à jour : Spec, com.spec.app, fenêtre 1280×800 minimum.");
