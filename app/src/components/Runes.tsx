import { createContext, useContext, useEffect, useState } from "react";
import { orderSpells, runePageFor, spellsFor, type RunePage as Page, type Stats } from "../lib/score";
import { champName, usePersistent } from "../lib/ui";
import { loadSpells, useInfo, type InfoMap } from "../lib/ddragon";

// Noms, descriptions et icônes officiels des runes (Data Dragon, en français).
interface RuneInfo { name: string; icon: string; desc: string }
export type RuneData = Map<number, RuneInfo>;

const CDN = "https://ddragon.leagueoflegends.com/cdn";

/** Import dans le client : fourni en direct, absent en démo. Renvoie un message d'erreur, ou null. */
export const RuneImportContext = createContext<((page: Page, champion: string) => Promise<string | null>) | null>(null);
/** Import des sorts d'invocateur (D puis F) : fourni en direct pendant la draft, absent sinon. */
export const SpellImportContext = createContext<((spell1: number, spell2: number) => Promise<string | null>) | null>(null);

/** Touche de Flash choisie par le joueur (F par défaut), gardée d'une partie à l'autre. */
export function useFlashKey(): ["D" | "F", (k: "D" | "F") => void] {
  return usePersistent<"D" | "F">("spec.flashKey", "F");
}
const SHARDS: Record<number, [string, string]> = {
  5008: ["Force adaptative", "StatModsAdaptiveForceIcon"],
  5005: ["Vitesse d’attaque", "StatModsAttackSpeedIcon"],
  5007: ["Accélération de compétence", "StatModsCDRScalingIcon"],
  5010: ["Vitesse de déplacement", "StatModsMovementSpeedIcon"],
  5001: ["PV croissants avec le niveau", "StatModsHealthPlusIcon"],
  5011: ["PV", "StatModsHealthScalingIcon"],
  5013: ["Ténacité et résistance aux ralentissements", "StatModsTenacityIcon"],
  5002: ["Armure", "StatModsArmorIcon"],
  5003: ["Résistance magique", "StatModsMagicResIcon"],
};

/** Texte brut d'une description Data Dragon (balises retirées sans jamais les interpréter). */
function plain(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

const cache = new Map<string, Promise<RuneData>>();

function loadRunes(version: string): Promise<RuneData> {
  if (!cache.has(version)) {
    cache.set(version, fetch(`${CDN}/${version}/data/fr_FR/runesReforged.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((trees: { id: number; name: string; icon: string; slots: { runes: { id: number; name: string; icon: string; shortDesc: string }[] }[] }[]) => {
        const map: RuneData = new Map();
        for (const t of trees) {
          map.set(t.id, { name: t.name, icon: `${CDN}/img/${t.icon}`, desc: "" });
          for (const slot of t.slots) for (const r of slot.runes) {
            map.set(r.id, { name: r.name, icon: `${CDN}/img/${r.icon}`, desc: plain(r.shortDesc) });
          }
        }
        for (const [id, [name, file]] of Object.entries(SHARDS)) {
          map.set(Number(id), { name, icon: `${CDN}/img/perk-images/StatMods/${file}.png`, desc: "Fragment de statistiques" });
        }
        return map;
      })
      .catch((e) => { cache.delete(version); throw e; }));
  }
  return cache.get(version)!;
}

export function useRuneData(version: string): RuneData | null {
  const [data, setData] = useState<RuneData | null>(null);
  useEffect(() => {
    let alive = true;
    loadRunes(version).then((d) => alive && setData(d)).catch(() => alive && setData(new Map()));
    return () => { alive = false; };
  }, [version]);
  return data;
}

export function Rune({ data, id, size }: { data: RuneData | null; id: number; size: "key" | "minor" | "shard" }) {
  const info = data?.get(id);
  const [failed, setFailed] = useState(false);
  return (
    <span className={`rune rune--${size}`} tabIndex={0} aria-label={info?.name ?? `Rune ${id}`}>
      {info && !failed
        ? <img src={info.icon} alt="" draggable={false} onError={() => setFailed(true)} />
        : <span className="rune__fallback" aria-hidden>{info?.name.slice(0, 1) ?? "?"}</span>}
      {info && (
        <span className="rune__tip" role="tooltip">
          <strong>{info.name}</strong>
          {info.desc && <span>{info.desc}</span>}
        </span>
      )}
    </span>
  );
}

/** Page de runes conseillée, en petites icônes ; la description apparaît au survol. */
export function RunePage({ stats, champ, role, laner }: { stats: Stats; champ: number; role: number; laner?: number | null }) {
  const data = useRuneData(stats.ddragon);
  const found = runePageFor(stats, champ, role, laner);
  if (!found) {
    return stats.runes.size === 0
      ? <p className="runes__empty">Runes conseillées : collecte des pages en cours.</p>
      : <p className="runes__empty">Pas encore assez de parties pour conseiller des runes.</p>;
  }
  const { page, vs } = found;
  return <RunePageView stats={stats} champ={champ} page={page} vs={vs} data={data}
                       spells={spellsFor(stats, champ, role, laner)} />;
}

function RunePageView({ stats, champ, page, vs, data, spells }:
  { stats: Stats; champ: number; page: Page; vs: number | null; data: RuneData | null;
    spells: { spells: [number, number]; vs: number | null } | null }) {
  const importer = useContext(RuneImportContext);
  const spellImporter = useContext(SpellImportContext);
  const spellInfo = useInfo(loadSpells, stats.ddragon);
  const [flashKey, setFlashKey] = useFlashKey();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ordered = spells ? orderSpells(spells.spells, flashKey) : null;
  const run = async () => {
    if (!importer) {
      setStatus({ ok: true, text: `Démo : en partie, ces runes remplacent la page sélectionnée dans ta draft${ordered ? " et les sorts sont choisis" : ""}.` });
      return;
    }
    setBusy(true);
    const name = champName(stats, champ);
    const error = await importer(page, name);
    const spellError = !error && ordered && spellImporter ? await spellImporter(ordered[0], ordered[1]) : null;
    setBusy(false);
    setStatus(error ? { ok: false, text: error }
      : spellError ? { ok: false, text: `Runes importées, mais pas les sorts : ${spellError}` }
      : { ok: true, text: `Runes importées dans ta page « Spec : ${name} runes »${ordered && spellImporter ? ", sorts choisis" : ""}.` });
  };
  const wr = page.games ? `${((page.wins / page.games) * 100).toFixed(1).replace(".", ",")} %` : "";
  return (
    <div className="runes">
      <span className="runes__label">
        Runes conseillées{vs != null ? ` face à ${champName(stats, vs)}` : ""}
        <span className="muted"> · {wr} sur {Math.round(page.games)} parties</span>
      </span>
      <div className="runes__row">
        <Rune data={data} id={page.keystone} size="key" />
        {page.primary.map((r) => <Rune key={`p${r}`} data={data} id={r} size="minor" />)}
        <span className="runes__sep" />
        {page.sub.map((r) => <Rune key={`s${r}`} data={data} id={r} size="minor" />)}
        <span className="runes__sep" />
        {page.shards.map((r, i) => <Rune key={`f${i}`} data={data} id={r} size="shard" />)}
        <button className="btn btn--secondary btn--tiny runes__import" onClick={run} disabled={busy}>
          {busy ? "Import…" : ordered ? "Importer runes et sorts" : "Importer dans le client"}
        </button>
      </div>
      {ordered && (
        <div className="spells">
          <span className="spells__label">Sorts{spells?.vs != null ? ` face à ${champName(stats, spells.vs)}` : ""}</span>
          <SpellKey data={spellInfo} id={ordered[0]} k="D" />
          <button className="spells__swap" onClick={() => setFlashKey(flashKey === "F" ? "D" : "F")}
                  title={`Flash sur ${flashKey === "F" ? "D" : "F"} plutôt`} aria-label="Inverser les touches des sorts">⇄</button>
          <SpellKey data={spellInfo} id={ordered[1]} k="F" />
          <span className="muted small">Flash sur {flashKey}, gardé pour tes prochaines parties</span>
        </div>
      )}
      {status && <p className={`runes__status${status.ok ? "" : " tone-bad"}`} role="status">{status.text}</p>}
    </div>
  );
}

function SpellKey({ data, id, k }: { data: InfoMap | null; id: number; k: "D" | "F" }) {
  const info = data?.get(id);
  return (
    <span className="spells__key" title={info?.name ?? `Sort ${id}`}>
      {info ? <img src={info.icon} alt={info.name} draggable={false} /> : <span className="spells__fallback" />}
      <kbd>{k}</kbd>
    </span>
  );
}

/** Page de runes en arbres (page champion) : arbre principal, arbre secondaire, fragments, avec les noms. */
export function RuneTree({ stats, champ, role }: { stats: Stats; champ: number; role: number }) {
  const data = useRuneData(stats.ddragon);
  const found = runePageFor(stats, champ, role, null);
  if (!found) return <p className="runes__empty">Pas encore assez de parties pour conseiller des runes.</p>;
  const { page } = found;
  const name = (id: number) => data?.get(id)?.name ?? "";
  // une seule ligne : chaque arbre est un groupe de runes côte à côte, nom sous l'icône
  const col = (title: string, ids: number[], keystone?: number) => (
    <div className="rtree__col" style={{ flexGrow: ids.length + (keystone != null ? 1 : 0) }}>
      <span className="rtree__title">{title}</span>
      <div className="rtree__runes">
        {keystone != null && (
          <span className="rtree__rune rtree__rune--key"><Rune data={data} id={keystone} size="key" /><strong>{name(keystone)}</strong></span>
        )}
        {ids.map((id, i) => (
          <span key={`${id}-${i}`} className="rtree__rune"><Rune data={data} id={id} size="minor" />{name(id)}</span>
        ))}
      </div>
    </div>
  );
  return (
    <div className="rtree">
      {col(name(page.primaryStyle) || "Arbre principal", page.primary, page.keystone)}
      {col(name(page.subStyle) || "Arbre secondaire", page.sub)}
      {col("Fragments", page.shards)}
    </div>
  );
}
