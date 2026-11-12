// Journal technique de Spec : les dernières erreurs et alertes, pour « Copier le journal » dans Réglages.
// Rien n'est envoyé : le joueur copie le texte et le colle où il veut (Discord, mail).
// On n'y met ni pseudo ni identifiant de compte.

const KEY = "spec.journal";
const MAX = 150;

interface Entry { at: number; level: "error" | "warn" | "info"; text: string }

let entries: Entry[] = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Entry[]; } catch { return []; }
})();
let saveTimer: number | undefined;

// retire ce qui ressemble à un identifiant de compte (PUUID, UUID) ou à un Riot ID
const scrub = (s: string) => s
  .replace(/[A-Za-z0-9_-]{60,}/g, "[id]")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
  .replace(/[^\s#"']{2,16}#[A-Za-z0-9]{2,5}\b/g, "[riot-id]");

function format(args: unknown[]): string {
  return args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}${a.stack ? `\n${a.stack.split("\n").slice(1, 4).join("\n")}` : ""}`
    : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
}

export function log(level: Entry["level"], ...args: unknown[]): void {
  entries.push({ at: Date.now(), level, text: scrub(format(args)).slice(0, 1200) });
  if (entries.length > MAX) entries = entries.slice(-MAX);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* stockage plein */ } }, 500);
}

let installed = false;
/** Capte console.error / console.warn et les erreurs non gérées. À appeler une fois au démarrage. */
export function installJournal(): void {
  if (installed) return;
  installed = true;
  const err = console.error.bind(console), warn = console.warn.bind(console);
  console.error = (...a: unknown[]) => { log("error", ...a); err(...a); };
  console.warn = (...a: unknown[]) => { log("warn", ...a); warn(...a); };
  window.addEventListener("error", (e) => log("error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => log("error", "Promesse rejetée :", e.reason));
  log("info", `Démarrage · ${location.search || "fenêtre principale"}`);
}

/** Texte à coller dans un message : version, système, puis les entrées les plus récentes. */
export function journalText(version: string | null): string {
  const head = [
    `Spec ${version ?? "?"} · ${new Date().toISOString()}`,
    navigator.userAgent,
    `Écran ${screen.width}×${screen.height} · échelle ${window.devicePixelRatio} · fenêtre ${innerWidth}×${innerHeight} · langue ${document.documentElement.lang || "?"}`,
    "",
  ];
  const lines = entries.slice(-80).map((e) => `${new Date(e.at).toISOString().slice(5, 19).replace("T", " ")} ${e.level.toUpperCase().padEnd(5)} ${e.text}`);
  return [...head, ...(lines.length ? lines : ["(aucune erreur enregistrée)"])].join("\n");
}
