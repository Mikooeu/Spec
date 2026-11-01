// Lecture du client LoL via les commandes Rust (src-tauri/src/lcu.rs).
// Spec ne lit que la phase, le compte, la région et la session de sélection.
// Il ne lit ni n'affiche les noms des autres joueurs, et ne verrouille jamais un pick.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export const IN_APP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** `puuid` = identifiant du joueur dans le client LoL (différent du PUUID de l'API Riot). */
export interface Account { name: string; region: string | null; puuid: string | null }

interface Member { cellId: number; championId: number; championPickIntent?: number; assignedPosition?: string }
interface Action { id: number; actorCellId: number; championId: number; completed: boolean; isInProgress?: boolean; type: string }
export interface Session {
  localPlayerCellId: number;
  myTeam: Member[];
  theirTeam: Member[];
  actions?: Action[][];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
}

export type ClientState =
  | { status: "browser" }                      // aperçu web, hors de l'appli
  | { status: "offline" }                      // client LoL fermé
  | { status: "idle"; account: Account | null; phase: string }
  | { status: "champselect"; account: Account | null; session: Session };

/** Draft en direct : comme la draft de démo, plus l'état lock / survol des alliés. */
export interface LiveDraft {
  role: number;
  assigned: boolean;                // rôle donné par le client (sinon choisi dans Spec)
  allies: (number | null)[];
  allyLocked: boolean[];
  enemies: (number | null)[];
  bans: number[];
  myChamp: number | null;           // ton champion : survolé ou verrouillé
  myLocked: boolean;
  banPhase: boolean;                // il te reste un ban à faire
}

const POSITIONS: Record<string, number> = { top: 0, jungle: 1, middle: 2, bottom: 3, utility: 4 };

async function lcuGet<T>(path: string): Promise<T> {
  return invoke<T>("lcu_get", { path });
}

/** Convertit la session du client en draft Spec. `chosenRole` sert quand le client n'assigne pas de rôle. */
export function sessionToDraft(s: Session, chosenRole: number | null): LiveDraft {
  const me = s.myTeam.find((m) => m.cellId === s.localPlayerCellId);
  const assignedRole = me?.assignedPosition ? POSITIONS[me.assignedPosition.toLowerCase()] : undefined;
  const role = chosenRole ?? assignedRole ?? 2;

  const allies: (number | null)[] = [null, null, null, null, null];
  const allyLocked = [false, false, false, false, false];
  const rest: { champ: number; locked: boolean }[] = [];

  for (const m of s.myTeam) {
    if (m.cellId === s.localPlayerCellId) continue;
    const locked = m.championId > 0;
    const champ = locked ? m.championId : m.championPickIntent ?? 0;
    if (champ <= 0) continue;
    const pos = m.assignedPosition ? POSITIONS[m.assignedPosition.toLowerCase()] : undefined;
    if (pos != null && pos !== role && allies[pos] == null) {
      allies[pos] = champ; allyLocked[pos] = locked;
    } else {
      rest.push({ champ, locked });
    }
  }
  // sans rôles assignés (partie perso, blind) : on remplit les places libres dans l'ordre
  for (const r of rest) {
    const free = allies.findIndex((c, i) => c == null && i !== role);
    if (free < 0) break;
    allies[free] = r.champ; allyLocked[free] = r.locked;
  }

  const enemies: (number | null)[] = [...s.theirTeam]
    .sort((a, b) => a.cellId - b.cellId)
    .map((m) => (m.championId > 0 ? m.championId : null));
  while (enemies.length < 5) enemies.push(null);

  const bans = new Set<number>([...(s.bans?.myTeamBans ?? []), ...(s.bans?.theirTeamBans ?? [])]);
  for (const a of (s.actions ?? []).flat()) {
    if (a.type === "ban" && a.completed && a.championId > 0) bans.add(a.championId);
  }
  bans.delete(0);

  const myLocked = (me?.championId ?? 0) > 0;
  const myChamp = myLocked ? me!.championId : (me?.championPickIntent ?? 0) > 0 ? me!.championPickIntent! : null;
  const banPhase = (s.actions ?? []).flat()
    .some((a) => a.actorCellId === s.localPlayerCellId && a.type === "ban" && !a.completed);

  return { role, assigned: assignedRole != null && chosenRole == null, allies, allyLocked,
           enemies: enemies.slice(0, 5), bans: [...bans], myChamp, myLocked, banPhase };
}

/** Action de pick du joueur encore ouverte, ou null. */
export function myPickAction(s: Session): Action | null {
  return (s.actions ?? []).flat()
    .find((a) => a.actorCellId === s.localPlayerCellId && a.type === "pick" && !a.completed) ?? null;
}

/** Survole le champion dans le client. Renvoie un message d'erreur, ou null si c'est fait. */
export async function preselect(s: Session, champ: number): Promise<string | null> {
  const action = myPickAction(s);
  if (!action) return "Ton pick est déjà verrouillé ou pas encore disponible.";
  try {
    await invoke("lcu_preselect", { actionId: action.id, championId: champ });
    return null;
  } catch {
    return "Le client n’a pas accepté la présélection. Réessaie dans un instant.";
  }
}

async function readAccount(): Promise<Account | null> {
  try {
    const me = await lcuGet<{ gameName?: string; tagLine?: string; displayName?: string; puuid?: string }>("/lol-summoner/v1/current-summoner");
    const name = me.gameName ? `${me.gameName}#${me.tagLine ?? ""}` : me.displayName ?? "";
    let region: string | null = null;
    try { region = (await lcuGet<{ region?: string }>("/riotclient/region-locale")).region ?? null; } catch { /* facultatif */ }
    return name ? { name, region, puuid: me.puuid ?? null } : null;
  } catch {
    return null;
  }
}

/** Interroge le client toutes les secondes en sélection, toutes les 2 s sinon. */
export function useLolClient(): ClientState {
  const [state, setState] = useState<ClientState>(IN_APP ? { status: "offline" } : { status: "browser" });
  const account = useRef<Account | null>(null);

  useEffect(() => {
    if (!IN_APP) return;
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      let delay = 2000;
      try {
        const phase = await lcuGet<string>("/lol-gameflow/v1/gameflow-phase");
        if (!account.current) account.current = await readAccount();
        if (phase === "ChampSelect") {
          delay = 1000;
          try {
            const session = await lcuGet<Session>("/lol-champ-select/v1/session");
            if (!stopped) setState({ status: "champselect", account: account.current, session });
          } catch {
            if (!stopped) setState({ status: "idle", account: account.current, phase });
          }
        } else if (!stopped) {
          setState({ status: "idle", account: account.current, phase });
        }
      } catch (e) {
        if (e === "not_running") account.current = null;
        if (!stopped) setState({ status: "offline" });
      }
      if (!stopped) timer = window.setTimeout(tick, delay);
    };

    tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  return state;
}

/** Importe une page de runes dans la page sélectionnée de la draft. Message d'erreur, ou null si c'est fait. */
export async function importRunes(page: { primaryStyle: number; subStyle: number; keystone: number;
  primary: number[]; sub: number[]; shards: number[] }): Promise<string | null> {
  const perks = [page.keystone, ...page.primary, ...page.sub, ...page.shards];
  try {
    await invoke("lcu_set_rune_page", { primaryStyle: page.primaryStyle, subStyle: page.subStyle, perks });
    return null;
  } catch (e) {
    if (e === "no_editable_page") {
      return "Sélectionne une de tes pages de runes dans la draft (pas une page de Riot), puis réessaie.";
    }
    if (e === "not_running") return "Le client LoL ne répond pas.";
    return "Le client n’a pas accepté les runes. Réessaie dans un instant.";
  }
}
