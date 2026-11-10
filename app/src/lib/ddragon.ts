// Noms, descriptions et icônes officiels des objets et sorts d'invocateur (Data Dragon, dans la langue de l'interface).
import { useEffect, useState } from "react";
import { ddragonLocale } from "./i18n";

export const CDN = "https://ddragon.leagueoflegends.com/cdn";
export interface Info { name: string; icon: string; desc: string; boots?: boolean; gold?: number; from?: number[] }
export type InfoMap = Map<number, Info>;

/** Texte brut d'une description Data Dragon (balises retirées sans jamais les interpréter). */
export function plain(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

const cache = new Map<string, Promise<InfoMap>>();

function load(key: string, url: string, parse: (json: { data: Record<string, unknown> }) => InfoMap): Promise<InfoMap> {
  if (!cache.has(key)) {
    cache.set(key, fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(parse)
      .catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key)!;
}

type RawItem = { name: string; plaintext?: string; image: { full: string }; tags?: string[]; gold?: { total: number }; from?: string[] };
type RawSpell = { key: string; name: string; description: string; image: { full: string } };

export function loadItems(version: string): Promise<InfoMap> {
  return load(`items-${version}-${ddragonLocale()}`, `${CDN}/${version}/data/${ddragonLocale()}/item.json`, ({ data }) => {
    const map: InfoMap = new Map();
    for (const [id, it] of Object.entries(data as Record<string, RawItem>)) {
      map.set(Number(id), { name: it.name, desc: it.plaintext ?? "", icon: `${CDN}/${version}/img/item/${it.image.full}`,
                            boots: it.tags?.includes("Boots") ?? false,
                            gold: it.gold?.total, from: it.from?.map(Number) });
    }
    return map;
  });
}

export function loadSpells(version: string): Promise<InfoMap> {
  return load(`spells-${version}-${ddragonLocale()}`, `${CDN}/${version}/data/${ddragonLocale()}/summoner.json`, ({ data }) => {
    const map: InfoMap = new Map();
    for (const s of Object.values(data as Record<string, RawSpell>)) {
      map.set(Number(s.key), { name: s.name, desc: plain(s.description), icon: `${CDN}/${version}/img/spell/${s.image.full}` });
    }
    return map;
  });
}

export function useInfo(loader: (v: string) => Promise<InfoMap>, version: string): InfoMap | null {
  const [data, setData] = useState<InfoMap | null>(null);
  useEffect(() => {
    let alive = true;
    loader(version).then((d) => alive && setData(d)).catch(() => alive && setData(new Map()));
    return () => { alive = false; };
  }, [loader, version]);
  return data;
}

type RawChampion = { id: string; name: string };
/** Noms officiels des champions dans la langue de l'interface, par identifiant Data Dragon (« MonkeyKing » → « Wukong »). */
export function loadChampionNames(version: string): Promise<Map<string, string>> {
  const key = `champions-${version}-${ddragonLocale()}`;
  if (!names.has(key)) {
    names.set(key, fetch(`${CDN}/${version}/data/${ddragonLocale()}/champion.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ data }: { data: Record<string, RawChampion> }) => new Map(Object.values(data).map((c) => [c.id, c.name])))
      .catch((e) => { names.delete(key); throw e; }));
  }
  return names.get(key)!;
}
const names = new Map<string, Promise<Map<string, string>>>();

/** Remplace les noms des champions des stats par leurs noms officiels dans la langue de l'interface. */
export async function localizeChampions<T extends { ddragon: string; champions: Map<number, { key: string; name: string }> }>(stats: T): Promise<T> {
  try {
    const names = await loadChampionNames(stats.ddragon);
    for (const c of stats.champions.values()) { const n = names.get(c.key); if (n) c.name = n; }
  } catch { /* hors ligne : on garde les noms des stats */ }
  return stats;
}
