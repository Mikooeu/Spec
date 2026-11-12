// Set d'objets « Spec · Ahri Mid » écrit dans le client : le shop en jeu le propose avec ce champion.
// Mêmes données que le menu de build en partie : départ, build dans l'ordre (bottes comprises),
// objets face à leur équipe et bottes selon leur équipe. Seul le set de Spec est remplacé (voir lcu.rs).

import { invoke } from "@tauri-apps/api/core";
import { adaptItems, bootChoice, buildSteps } from "../components/InGameScreen";
import type { InfoMap } from "./ddragon";
import { t } from "./i18n";
import { ROLE_LABELS, type Stats } from "./score";
import { champName } from "./ui";
import { usePersistent } from "./ui";

/** Réglage : écrire le set d'objets (à l'import et à la fin de la draft). */
export const useItemSetSetting = () => usePersistent<boolean>("spec.itemset", true);
export function itemSetEnabled(): boolean {
  try { return JSON.parse(localStorage.getItem("spec.itemset") ?? "true") !== false; } catch { return true; }
}

export interface ItemBlock { title: string; items: number[] }

/** Blocs du set pour ce champion, ce rôle et ces adversaires (vide si les stats n'ont pas encore de build). */
export function itemSetBlocks(stats: Stats, champ: number, role: number, enemies: number[], items: InfoMap | null): ItemBlock[] {
  const page = stats.champPages.get(`${champ}|${role}`) ?? null;
  if (!page) return [];
  const blocks: ItemBlock[] = [];
  const start = (page.start[0]?.[0] ?? "").split(",").map(Number).filter((n) => n > 0);
  if (start.length) blocks.push({ title: t("Départ"), items: start });
  const boots = bootChoice(stats, page, champ, role, enemies, items);
  const steps = buildSteps(page, [], boots?.main ?? null, false);
  if (steps.length) blocks.push({ title: t("Build"), items: steps.map((s) => s.id) });
  const adapts = adaptItems(stats, champ, role, enemies, items, steps, []).slice(0, 6).map((a) => a.id);
  if (adapts.length) blocks.push({ title: t("Face à leur équipe"), items: adapts });
  const bootList = [boots?.main, boots?.alt?.id].filter((x): x is number => x != null);
  if (bootList.length > 1) blocks.push({ title: t("Bottes selon leur équipe"), items: bootList });
  return blocks;
}

/** Écrit le set dans le client. Message d'erreur, ou null si c'est fait. */
export async function importItemSet(stats: Stats, champ: number, role: number, enemies: number[], items: InfoMap | null): Promise<string | null> {
  const blocks = itemSetBlocks(stats, champ, role, enemies, items);
  if (!blocks.length) return t("pas encore assez de parties pour un set d’objets.");
  const title = `Spec · ${champName(stats, champ)} ${ROLE_LABELS[role]}`;
  try {
    await invoke("lcu_set_item_set", { champion: champ, title, blocks });
    return null;
  } catch (e) {
    if (e === "not_running") return t("le client LoL ne répond pas.");
    return t("le client n’a pas accepté le set d’objets.");
  }
}
