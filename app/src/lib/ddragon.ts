// Noms, descriptions et icônes officiels des objets et sorts d'invocateur (Data Dragon, en français).
import { useEffect, useState } from "react";

export const CDN = "https://ddragon.leagueoflegends.com/cdn";
export interface Info { name: string; icon: string; desc: string }
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

type RawItem = { name: string; plaintext?: string; image: { full: string } };
type RawSpell = { key: string; name: string; description: string; image: { full: string } };

export function loadItems(version: string): Promise<InfoMap> {
  return load(`items-${version}`, `${CDN}/${version}/data/fr_FR/item.json`, ({ data }) => {
    const map: InfoMap = new Map();
    for (const [id, it] of Object.entries(data as Record<string, RawItem>)) {
      map.set(Number(id), { name: it.name, desc: it.plaintext ?? "", icon: `${CDN}/${version}/img/item/${it.image.full}` });
    }
    return map;
  });
}

export function loadSpells(version: string): Promise<InfoMap> {
  return load(`spells-${version}`, `${CDN}/${version}/data/fr_FR/summoner.json`, ({ data }) => {
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
