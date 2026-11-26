// Lien entre la fenêtre principale et les fenêtres d'appoint (mode compact collé, bulle, menu de build seul).
// La fenêtre principale reste la seule à lire le client et à décider : elle envoie l'état de la draft aux autres
// fenêtres, qui lui renvoient les actions du joueur (présélection, ban…). Les stats, elles, sont rechargées
// par chaque fenêtre depuis le cache du navigateur (même adresse, pas de lecture en plus côté serveur).

import { useEffect, useRef, useState } from "react";
import { IN_APP } from "./lcu";
import type { Draft } from "../components/DraftScreen";
import type { PersonalState } from "./api";
import type { AutoImport } from "../components/Runes";
import type { GameStart } from "../components/InGameScreen";
import type { FullscreenState } from "../components/FullscreenNotice";

export interface SharedState {
  draft: Draft | null;
  live: boolean;
  pool: number[];
  perso?: PersonalState;
  autoImport: AutoImport | null;
  clientOn: boolean;
  clientText: string;
  inGame: GameStart | null;
  /** Jeu réglé en Plein écran pendant la draft (voir FullscreenNotice). */
  fullscreen?: FullscreenState;
}

export type BridgeAction =
  | { kind: "preselect"; champ: number }
  | { kind: "ban"; champ: number }
  | { kind: "role"; role: number }
  | { kind: "pool"; role: number }
  | { kind: "expand" }
  | { kind: "borderless" };

const STATE = "spec:state", HELLO = "spec:hello", ACTION = "spec:action", RESULT = "spec:result";

// Les Map des stats perso ne passent pas telles quelles dans un évènement : on les met à plat.
type Wire = Omit<SharedState, "perso"> & { perso?: unknown };
function toWire(s: SharedState): Wire {
  const p = s.perso;
  if (p?.kind !== "ready") return s;
  const d = p.data;
  return { ...s, perso: { kind: "ready", data: { ...d, byRole: [...d.byRole], byChamp: [...d.byChamp], matchups: [...d.matchups] } } };
}
function fromWire(w: Wire): SharedState {
  const p = w.perso as { kind: string; data?: Record<string, unknown> } | undefined;
  if (p?.kind !== "ready" || !p.data) return w as SharedState;
  const d = p.data;
  return { ...w, perso: { kind: "ready", data: { ...d, byRole: new Map(d.byRole as []), byChamp: new Map(d.byChamp as []), matchups: new Map(d.matchups as []) } } } as SharedState;
}

async function ev() { return import("@tauri-apps/api/event"); }

/** Fenêtre principale : envoie l'état à chaque changement, et à chaque fenêtre qui vient de s'ouvrir. */
export function usePublishState(state: SharedState, onAction: (a: BridgeAction) => Promise<string | null>) {
  const last = useRef(state);
  last.current = state;
  const act = useRef(onAction);
  act.current = onAction;
  useEffect(() => {
    if (!IN_APP) return;
    ev().then(({ emit }) => emit(STATE, toWire(state))).catch(() => undefined);
  }, [state]);
  useEffect(() => {
    if (!IN_APP) return;
    const stops: (() => void)[] = [];
    let cancelled = false;
    ev().then(async ({ listen, emit }) => {
      const a = await listen(HELLO, () => { emit(STATE, toWire(last.current)); });
      const b = await listen<{ id: number; action: BridgeAction }>(ACTION, async (e) => {
        let result: string | null = null;
        try { result = await act.current(e.payload.action); } catch (err) { result = String(err); }
        emit(RESULT, { id: e.payload.id, result });
      });
      if (cancelled) { a(); b(); } else stops.push(a, b);
    }).catch(() => undefined);
    return () => { cancelled = true; stops.forEach((s) => s()); };
  }, []);
}

/** Fenêtre d'appoint : dernier état reçu de la fenêtre principale (null tant que rien n'est arrivé). */
export function useSharedState(): SharedState | null {
  const [state, setState] = useState<SharedState | null>(null);
  useEffect(() => {
    if (!IN_APP) return;
    let stop: (() => void) | null = null, cancelled = false;
    ev().then(async ({ listen, emit }) => {
      const un = await listen<Wire>(STATE, (e) => setState(fromWire(e.payload)));
      if (cancelled) un(); else stop = un;
      emit(HELLO, null);
    }).catch(() => undefined);
    return () => { cancelled = true; stop?.(); };
  }, []);
  return state;
}

let nextId = 1;
/** Fenêtre d'appoint : demande une action à la fenêtre principale, renvoie son message d'erreur ou null. */
export async function sendAction(action: BridgeAction): Promise<string | null> {
  if (!IN_APP) return null;
  const { listen, emit } = await ev();
  const id = nextId++ + Math.random();
  return new Promise((resolve) => {
    let un: (() => void) | null = null;
    const timer = window.setTimeout(() => { un?.(); resolve(null); }, 8000);
    listen<{ id: number; result: string | null }>(RESULT, (e) => {
      if (e.payload.id !== id) return;
      window.clearTimeout(timer); un?.(); resolve(e.payload.result);
    }).then((u) => { un = u; emit(ACTION, { id, action }); });
  });
}
