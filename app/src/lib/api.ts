// Serveur Spec (Cloudflare) : stats Master+ et stats perso de la saison.
import { useCallback, useEffect, useState } from "react";
import { parseStats, type Stats } from "./score";

export const API_URL = ((import.meta.env.VITE_SPEC_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

export type Region = "world" | "euw" | "kr" | "na";
/** Ordre du sélecteur ; l'EUW est la région par défaut (et celle de la draft). */
export const REGIONS: [Region, string][] = [["world", "World"], ["euw", "EUW"], ["kr", "KR"], ["na", "NA"]];

/** Stats Master+ : depuis le serveur si configuré, sinon le fichier exporté localement (EUW seulement). */
export async function loadStats(region: Region = "euw"): Promise<Stats> {
  const sources = region !== "euw" ? (API_URL ? [`${API_URL}/v1/stats?region=${region}`] : [])
    : API_URL ? [`${API_URL}/v1/stats`, "/stats.json"] : ["/stats.json"];
  let lastError: unknown = null;
  for (const url of sources) {
    try {
      const r = await fetch(url);
      if (r.ok) return parseStats(await r.json());
      lastError = new Error(`HTTP ${r.status}`);
    } catch (e) { lastError = e; }
  }
  throw lastError ?? new Error("stats introuvables");
}

const regionCache = new Map<Region, Promise<Stats>>();

export type RegionStats = { kind: "ready"; stats: Stats } | { kind: "loading" } | { kind: "missing" };

/** Stats d'une région, téléchargées seulement quand on la choisit (l'EUW est déjà chargée au démarrage). */
export function useRegionStats(euw: Stats | null, region: Region): RegionStats {
  const [state, setState] = useState<RegionStats>({ kind: "loading" });
  useEffect(() => {
    if (region === "euw") return;
    let alive = true;
    if (!regionCache.has(region)) {
      regionCache.set(region, loadStats(region).catch((e) => { regionCache.delete(region); throw e; }));
    }
    setState({ kind: "loading" });
    regionCache.get(region)!
      .then((stats) => alive && setState({ kind: "ready", stats }))
      .catch(() => alive && setState({ kind: "missing" }));
    return () => { alive = false; };
  }, [region]);
  if (region === "euw") return euw ? { kind: "ready", stats: euw } : { kind: "loading" };
  return state;
}

type GW = [number, number]; // parties, victoires

export interface Personal {
  matches: number;
  pending: number;
  syncing: boolean;
  byRole: Map<string, GW>;     // `${champ}:${role}`
  byChamp: Map<number, GW>;    // toutes lanes
  matchups: Map<string, GW>;   // `${champ}:${role}:${adversaire}`
  champions: [number, number, number, number][];
}

export type PersonalState =
  | { kind: "off" }                 // aucun serveur configuré
  | { kind: "no-account" }          // client LoL jamais vu : PUUID inconnu
  | { kind: "loading" }
  | { kind: "unregistered" }
  | { kind: "error" }
  | { kind: "ready"; data: Personal };

function parsePersonal(raw: {
  status: { matches: number; pending: number; syncing: boolean };
  champions: [number, number, number, number][];
  matchups: [number, number, number, number, number][];
}): Personal {
  const byRole = new Map<string, GW>(), byChamp = new Map<number, GW>(), matchups = new Map<string, GW>();
  for (const [c, r, g, w] of raw.champions) {
    byRole.set(`${c}:${r}`, [g, w]);
    const t = byChamp.get(c) ?? [0, 0];
    byChamp.set(c, [t[0] + g, t[1] + w]);
  }
  for (const [c, r, o, g, w] of raw.matchups) matchups.set(`${c}:${r}:${o}`, [g, w]);
  return { ...raw.status, byRole, byChamp, matchups, champions: raw.champions };
}

/** Stats perso du joueur (`client` = identifiant du client LoL), rafraîchies chaque minute pendant la synchro, toutes les 10 min ensuite. */
export function usePersonal(client: string | null): [PersonalState, () => void] {
  const [state, setState] = useState<PersonalState>(API_URL ? { kind: "loading" } : { kind: "off" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!API_URL) return;
    if (!client) { setState({ kind: "no-account" }); return; }
    let stopped = false;
    let timer: number | undefined;
    const load = async () => {
      let delay = 600_000;
      try {
        const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(client)}`);
        if (r.status === 404) { if (!stopped) setState({ kind: "unregistered" }); return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = parsePersonal(await r.json());
        if (!stopped) setState({ kind: "ready", data });
        if (data.syncing) delay = 60_000;
      } catch {
        if (!stopped) setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        delay = 120_000;
      }
      if (!stopped) timer = window.setTimeout(load, delay);
    };
    load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [client, tick]);

  return [state, refresh];
}

/**
 * Inscription avec le code d'invitation. `client` = identifiant du joueur dans le client LoL,
 * `riotId` = « Nom#TAG » : le serveur s'en sert une fois pour retrouver le compte chez Riot.
 * Renvoie un message d'erreur, ou null si c'est bon.
 */
export async function register(client: string, riotId: string, invite: string): Promise<string | null> {
  try {
    const r = await fetch(`${API_URL}/v1/players`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, riotId, invite: invite.trim() }),
    });
    if (r.ok) return null;
    const code = ((await r.json().catch(() => ({}))) as { error?: string }).error;
    if (code === "bad_invite") return "Code d’invitation incorrect.";
    if (code === "full") return "Le serveur est complet : demande à la personne qui gère Spec de faire de la place.";
    if (code === "already_linked") return "Ce compte est déjà activé sur un autre PC. Demande à la personne qui gère Spec d’autoriser ce PC, puis réessaie dans les 15 minutes.";
    if (code === "unknown_riot_id") return "Riot ne trouve pas ce compte. Relance le client LoL puis réessaie.";
    if (code === "bad_riot_id") return "Riot ID non reconnu : relance le client LoL puis réessaie.";
    if (code === "riot_unavailable") return "Riot ne répond pas pour l’instant. Réessaie dans une minute.";
    return "Le serveur n’a pas accepté l’inscription. Réessaie dans un instant.";
  } catch {
    return "Serveur injoignable. Vérifie ta connexion.";
  }
}

/** Champions les plus joués par rôle cette saison (au moins `min` parties dans ce rôle), pour préremplir le pool. */
export const PREFILL_MIN_GAMES = 25;

export function topChampions(p: Personal, role: number, limit = 6, min = PREFILL_MIN_GAMES): number[] {
  return p.champions
    .filter(([, r, g]) => r === role && g >= min)
    .sort((a, b) => b[2] - a[2])
    .slice(0, limit)
    .map(([c]) => c);
}
