// Notes de matchup : une note courte par duo « ton champion contre son vis-à-vis », gardée sur le PC.
import { usePersistent } from "./ui";

export const NOTE_MAX = 280;

export const noteKey = (champ: number, enemy: number) => `${champ}:${enemy}`;

export function useMatchupNotes(): [Record<string, string>, (n: Record<string, string>) => void] {
  return usePersistent<Record<string, string>>("spec.matchupNotes", {});
}
