import { REGIONS, type Region } from "../lib/api";

/** Choix de la région des stats (tier list et page champion). La draft reste toujours sur l'EUW. */
export function RegionSelect({ value, onChange }: { value: Region; onChange: (r: Region) => void }) {
  return (
    <div className="segmented" role="tablist" aria-label="Région des stats">
      {REGIONS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? "is-active" : ""}
                onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  );
}

export const REGION_LABEL: Record<Region, string> = Object.fromEntries(REGIONS) as Record<Region, string>;
