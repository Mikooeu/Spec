import { useState } from "react";
import {
  ROLE_LABELS, gamesIn, smoothed, tierLetter, type ChampPage, type Stats,
} from "../lib/score";
import { champName, int, patchLabel, pct, wrTone } from "../lib/ui";
import { loadItems, loadSpells, useInfo, type InfoMap } from "../lib/ddragon";
import { ChampionIcon } from "./ChampionIcon";
import { RuneTree } from "./Runes";

interface Props {
  stats: Stats;
  champ: number;
  role: number;
  onRole: (role: number) => void;
  onBack: () => void;
  /** Ouverte automatiquement au lancement de la partie. */
  inGame?: boolean;
}

const ROLE_MIN_GAMES = 200;   // un rôle est proposé à partir de ce nombre de parties
const RARE = 0.01;            // en dessous de 1 % des parties, l'objet est grisé
const RELATIVE = 0.015;       // vert / rouge à 1,5 point de la moyenne du rang

/** Page d'un champion : ordre des sorts, runes, objets de départ, sorts d'invocateur, bottes, objets, builds. */
export function ChampionScreen({ stats, champ, role, onRole, onBack, inGame = false }: Props) {
  const items = useInfo(loadItems, stats.ddragon);
  const spells = useInfo(loadSpells, stats.ddragon);
  const page = stats.champPages.get(`${champ}|${role}`) ?? null;
  const [g, w] = stats.base.get(`${champ}|${role}`) ?? [0, 0];
  const winrate = g ? w / g : 0;
  const pickrate = stats.matchesWeighted ? g / stats.matchesWeighted : 0;
  const banrate = stats.banMatches > 0 ? (stats.bans.get(champ) ?? 0) / stats.banMatches : null;
  const tier = g ? tierLetter(smoothed(g, w, 0.5, stats.params.k_base)) : "—";
  const roles = [0, 1, 2, 3, 4].filter((r) => r === role || gamesIn(stats, champ, r) >= ROLE_MIN_GAMES);
  const ranks = role === 3 ? 6 : 5;

  return (
    <div className="content champ">
      <button className="link-back" onClick={onBack}>← {inGame ? "Draft" : `Tier list · ${ROLE_LABELS[role]}`}</button>
      <header className="champ__head">
        <ChampionIcon stats={stats} champ={champ} size={3.5} />
        <div>
          <p className="overline">
            {inGame ? "En partie · " : ""}{ROLE_LABELS[role]} · Tier {tier} · patch {patchLabel(stats.meta.patch)}
          </p>
          <h1>{champName(stats, champ)}</h1>
        </div>
        <span className="grow" />
        <div className="champ__stats">
          <Stat value={pct(winrate)} label="Winrate" tone={wrTone(winrate)} />
          <Stat value={pct(pickrate)} label="Pickrate" />
          <Stat value={banrate == null ? "—" : pct(banrate)} label="Banrate" />
          <Stat value={int(g)} label="Parties" />
        </div>
      </header>
      {roles.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Rôle">
          {roles.map((r) => (
            <button key={r} role="tab" aria-selected={r === role} className={r === role ? "is-active" : ""}
                    onClick={() => onRole(r)}>{ROLE_LABELS[r]}</button>
          ))}
        </div>
      )}

      <Card title="Ordre des sorts"
            sub={page?.skills ? `Priorité ${page.skills[1].replace(/ > /g, " › ")} · ${share(page.skills[2], page.tg)} des parties` : undefined}>
        {page?.skills ? <SkillGrid order={page.skills[0]} /> : <Empty page={page} timeline />}
      </Card>

      <Card title="Runes" sub={runeSub(stats, champ, role)}>
        <RuneTree stats={stats} champ={champ} role={role} />
      </Card>

      <div className="champ__row champ__row--3">
        <Card title="Objets de départ" sub="Les 3 combinaisons les plus jouées">
          {page?.start.length ? (
            <div className="combos combos--stack">
              {page.start.map(([ids, cg, cw]) => (
                <Combo key={ids} icons={groupIcons(ids)} data={items} wr={cw / cg} pr={cg / page.tg} />
              ))}
            </div>
          ) : <Empty page={page} timeline />}
        </Card>
        <Card title="Sorts d’invocateur" sub="Les 2 combinaisons les plus jouées">
          {page?.spells.length ? (
            <div className="combos combos--stack">
              {page.spells.map(([a, b, cg, cw]) => (
                <Combo key={`${a}-${b}`} icons={[[a, 1], [b, 1]]} data={spells} wr={cw / cg} pr={cg / page.g} />
              ))}
            </div>
          ) : <Empty page={page} />}
        </Card>
        <Card title="Bottes" sub="Les 3 plus jouées">
          {page?.boots.length ? (
            <div className="cells">
              {page.boots.map(([id, bg, bw]) => <Cell key={id} id={id} data={items} wr={bw / bg} pr={bg / page.g} />)}
            </div>
          ) : <Empty page={page} />}
        </Card>
      </div>

      <Card title="Objets" sub="Winrate et pickrate selon l’objet acheté en 1er, 2e, 3e… Couleur : par rapport aux autres choix au même rang.">
        {page?.items.length ? (
          <div className="item-ranks">
            {page.items.slice(0, ranks).map(([rankGames, list], k) => {
              const total = list.reduce((a, [, ig]) => a + ig, 0);
              const avg = total ? list.reduce((a, [, , iw]) => a + iw, 0) / total : 0;
              return (
                <div key={k} className="item-rank">
                  <span className="item-rank__label">Objet {k + 1}<span>moy. {pct(avg)}</span></span>
                  {list.map(([id, ig, iw]) => (
                    <Cell key={id} id={id} data={items} wr={iw / ig} pr={ig / rankGames}
                          tone={relTone(iw / ig, avg)} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : <Empty page={page} timeline />}
      </Card>

      <Card title="Builds complets" sub={`Les 3 enchaînements de ${ranks} objets avec le meilleur winrate`}>
        {page?.builds.length ? (
          <div className="builds">
            {page.builds.map(([seq, bg, bw]) => (
              <div key={seq.join("-")} className="build">
                <span className="build__items">
                  {seq.map((id, i) => (
                    <span key={`${id}-${i}`} className="build__step">
                      {i > 0 && <span className="build__arrow" aria-hidden>›</span>}
                      <ItemIcon id={id} data={items} />
                    </span>
                  ))}
                </span>
                <span className="grow" />
                <span className="stat-col">
                  <span className={`stat-col__value tone-${wrTone(bw / bg)}`}>{pct(bw / bg)}</span>
                  <span className="stat-col__label">{share(bg, page.tg)} des parties</span>
                </span>
              </div>
            ))}
          </div>
        ) : <Empty page={page} timeline note={`Il faut assez de parties avec les ${ranks} mêmes objets dans le même ordre.`} />}
      </Card>
    </div>
  );
}

const share = (part: number, total: number) => (total ? pct(part / total) : "—");

function relTone(wr: number, avg: number): "good" | "bad" | "neutral" {
  return wr - avg >= RELATIVE ? "good" : avg - wr >= RELATIVE ? "bad" : "neutral";
}

function runeSub(stats: Stats, champ: number, role: number): string | undefined {
  const p = stats.runes.get(`${champ}|${role}`)?.[0];
  if (!p || !p.games) return undefined;
  return `Meilleure page · ${pct(p.wins / p.games)} de winrate · ${int(p.games)} parties`;
}

/** « 1056,2003,2003 » -> [[1056, 1], [2003, 2]] */
function groupIcons(ids: string): [number, number][] {
  const out: [number, number][] = [];
  for (const id of ids.split(",").map(Number)) {
    const last = out.find(([x]) => x === id);
    if (last) last[1] += 1; else out.push([id, 1]);
  }
  return out;
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <span className="stat-col">
      <span className={`champ__stat${tone ? ` tone-${tone}` : ""}`}>{value}</span>
      <span className="stat-col__label">{label}</span>
    </span>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card champ__card">
      <div>
        <h2>{title}</h2>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ page, timeline = false, note }: { page: ChampPage | null; timeline?: boolean; note?: string }) {
  const n = page ? (timeline ? page.tg : page.g) : 0;
  return (
    <p className="runes__empty">
      Collecte en cours{n ? ` (${int(n)} parties analysées pour l’instant)` : ""}. {note ?? ""}
    </p>
  );
}

export function ItemIcon({ id, data, size = "md" }: { id: number; data: InfoMap | null; size?: "md" | "sm" }) {
  const info = data?.get(id);
  const [failed, setFailed] = useState(false);
  return (
    <span className={`item-ic item-ic--${size}`} tabIndex={0} aria-label={info?.name ?? `Objet ${id}`}>
      {info && !failed ? <img src={info.icon} alt="" draggable={false} onError={() => setFailed(true)} /> : null}
      {info && (
        <span className="rune__tip" role="tooltip">
          <strong>{info.name}</strong>
          {info.desc && <span>{info.desc}</span>}
        </span>
      )}
    </span>
  );
}

function Cell({ id, data, wr, pr, tone }: { id: number; data: InfoMap | null; wr: number; pr: number; tone?: string }) {
  return (
    <span className={`cell${pr < RARE ? " is-rare" : ""}`}>
      <ItemIcon id={id} data={data} />
      <span className={`cell__wr tone-${tone ?? wrTone(wr)}`}>{pct(wr)}</span>
      <span className="cell__pr">{pct(pr)}</span>
    </span>
  );
}

function Combo({ icons, data, wr, pr }: { icons: [number, number][]; data: InfoMap | null; wr: number; pr: number }) {
  return (
    <span className="combo">
      <span className="combo__icons">
        {icons.map(([id, n]) => (
          <span key={id} className="combo__icon">
            <ItemIcon id={id} data={data} />
            {n > 1 && <span className="combo__count">×{n}</span>}
          </span>
        ))}
      </span>
      <span className="stat-col stat-col--left">
        <span className={`stat-col__value tone-${wrTone(wr)}`}>{pct(wr)}</span>
        <span className="stat-col__label">{pct(pr)} des parties</span>
      </span>
    </span>
  );
}

/** Grille niveaux × sorts : la case du sort monté à chaque niveau est remplie. */
function SkillGrid({ order }: { order: string }) {
  return (
    <div className="skills" role="table" aria-label="Ordre des sorts">
      {["Q", "W", "E", "R"].map((s) => (
        <div key={s} className="skills__row" role="row">
          <span className="skills__key">{s}</span>
          {order.split("").map((x, i) => (
            <span key={i} className={`skills__cell${x === s ? (s === "R" ? " is-ult" : " is-on") : ""}`} role="cell">
              {x === s ? i + 1 : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
