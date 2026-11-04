import { useEffect, useMemo, useRef, useState } from "react";
import type { Stats } from "../lib/score";
import { normalize } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { t } from "../lib/i18n";

interface Props {
  stats: Stats;
  title: string;
  taken: Set<number>;
  canClear: boolean;
  onPick: (champ: number | null) => void;
  onClose: () => void;
}

export function ChampionPicker({ stats, title, taken, canClear, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = useMemo(() => {
    const q = normalize(query);
    return [...stats.champions.values()]
      .filter((c) => !taken.has(c.id) && (!q || normalize(c.name).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stats, query, taken]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="picker" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker__head">
          <h2>{title}</h2>
          {canClear && <button className="btn btn--secondary" onClick={() => onPick(null)}>{t("Vider")}</button>}
        </div>
        <input ref={input} className="search" placeholder={t("Rechercher un champion")} value={query}
               onChange={(e) => setQuery(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && list[0] && onPick(list[0].id)} />
        <div className="picker__grid">
          {list.map((c) => (
            <button key={c.id} className="tile" onClick={() => onPick(c.id)}>
              <ChampionIcon stats={stats} champ={c.id} size={3} />
              <span>{c.name}</span>
            </button>
          ))}
          {list.length === 0 && <p className="muted">{t("Aucun champion ne correspond.")}</p>}
        </div>
      </div>
    </div>
  );
}
