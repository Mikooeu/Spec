import { useContext, useState, type ReactNode } from "react";
import {
  ROLE_LABELS, gamesIn, tierLetter, tierScore, type ChampPage, type Stats,
} from "../lib/score";
import { champName, int, patchLabel, pct, pctN, wrTone } from "../lib/ui";
import { loadItems, loadSpells, useInfo, type InfoMap } from "../lib/ddragon";
import { ChampionIcon } from "./ChampionIcon";
import { InButton } from "./Runes";
import { RuneTree } from "./Runes";
import { Segmented } from "./Segmented";
import { Trend } from "./Trend";
import { t } from "../lib/i18n";
import type { Personal } from "../lib/api";
import { ChampionMatchups, MIN_PERSO_GAMES } from "./ChampionMatchups";

interface Props {
  stats: Stats;
  champ: number;
  role: number;
  onRole: (role: number) => void;
  onBack: () => void;
  /** Ouverte automatiquement au lancement de la partie. */
  inGame?: boolean;
  /** Sélecteur de région des stats. */
  region?: ReactNode;
  regionLabel?: string;
  /** Stats perso (ton winrate sur ce champion et face à chaque adversaire). */
  perso?: Personal | null;
}

const ROLE_MIN_GAMES = 200;   // un rôle est proposé à partir de ce nombre de parties
const RARE = 0.01;            // en dessous de 1 % des parties, l'objet est grisé
const RELATIVE = 0.015;       // vert / rouge à 1,5 point de la moyenne du rang

/** Page d'un champion : ordre des sorts, runes, objets de départ, sorts d'invocateur, bottes, objets, builds. */
export function ChampionScreen({ stats, champ, role, onRole, onBack, inGame = false, region, regionLabel = "EUW", perso = null }: Props) {
  const [tab, setTab] = useState<"build" | "matchups">("build");
  const me = perso?.byRole.get(`${champ}:${role}`) ?? null;
  const meWr = me && me[0] > 0 ? me[1] / me[0] : null;
  const items = useInfo(loadItems, stats.ddragon);
  const spells = useInfo(loadSpells, stats.ddragon);
  const page = stats.champPages.get(`${champ}|${role}`) ?? null;
  const [g, w] = stats.base.get(`${champ}|${role}`) ?? [0, 0];
  const winrate = g ? w / g : 0;
  const pickrate = stats.matchesWeighted ? g / stats.matchesWeighted : 0;
  const banrate = stats.banMatches > 0 ? (stats.bans.get(champ) ?? 0) / stats.banMatches : null;
  const tier = g ? tierLetter(tierScore(stats, champ, role)) : "—";
  const roles = [0, 1, 2, 3, 4].filter((r) => r === role || gamesIn(stats, champ, r) >= ROLE_MIN_GAMES);
  const ranks = role === 3 ? 6 : 5;
  const allGames = [0, 1, 2, 3, 4].reduce((a, r) => a + gamesIn(stats, champ, r), 0);
  const roleShare = (r: number) => (allGames ? gamesIn(stats, champ, r) / allGames : 0);

  return (
    <div className="content champ">
      <div className="champ__top">
        <button className="link-back" onClick={onBack}>← {inGame ? t("Draft") : t("Tier list · {v}", { v: ROLE_LABELS[role] })}</button>
        {region}
      </div>
      <header className="champ__head">
        <ChampionIcon stats={stats} champ={champ} size={3.5} />
        <div>
          <p className="overline">
            {inGame ? t("En partie · ") : ""}{t("{role} · Tier {tier} · Master+ {region} · patch {patch}", { role: ROLE_LABELS[role], tier, region: regionLabel, patch: patchLabel(stats.meta.patch) })}
          </p>
          <h1>{champName(stats, champ)}</h1>
        </div>
        <span className="grow" />
        <div className="champ__stats">
          <Stat value={pct(winrate)} label={t("Winrate")} tone={wrTone(winrate)} />
          <Stat value={pct(pickrate)} label={t("Pickrate")} />
          {banrate != null && <Stat value={pct(banrate)} label={t("Banrate")} />}
          <Stat value={int(g)} label={t("Parties")} />
          {me && meWr != null && (
            <>
              <span className="champ__sep" aria-hidden />
              <Stat value={pct(meWr)} label={t("Toi · {n} parties", { n: me[0] })} tone={me[0] >= MIN_PERSO_GAMES ? wrTone(meWr) : undefined} />
            </>
          )}
        </div>
      </header>
      <div className="champ__bar">
        {!inGame && (
          <Segmented className="segmented" role="tablist" aria-label={t("Onglets")}>
            {(["build", "matchups"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "is-active" : ""}
                      onClick={() => setTab(k)}>{k === "build" ? t("Build") : t("Matchups")}</button>
            ))}
          </Segmented>
        )}
        <span className="grow" />
        {roles.length > 1 && (
          <Segmented className="segmented" role="tablist" aria-label={t("Rôle")}>
            {roles.map((r) => (
              <button key={r} role="tab" aria-selected={r === role} className={r === role ? "is-active" : ""}
                      onClick={() => onRole(r)}>{ROLE_LABELS[r]}<span className="champ__share">{pctN(Math.round(roleShare(r) * 100))}</span></button>
            ))}
          </Segmented>
        )}
      </div>

      {tab === "matchups" && !inGame ? <ChampionMatchups stats={stats} champ={champ} role={role} perso={perso} /> :

      (() => {
        // sections sans données : masquées ; tout vide → un seul message plutôt que « Collecte en cours » partout
        const has = {
          skills: !!page?.skills, runes: !!stats.runes.get(`${champ}|${role}`)?.[0]?.games, start: !!page?.start.length,
          spells: !!page?.spells.length, boots: !!page?.boots.length, items: !!page?.items.length, builds: !!page?.builds.length,
        };
        const row = [has.start, has.spells, has.boots].filter(Boolean).length;
        if (!Object.values(has).some(Boolean)) return (
          <section className="card champ__card champ__empty">
            <h2>{t("Builds en cours de collecte")}</h2>
            <p className="muted small">{t("Pas encore assez de parties de {c} en {r} pour conseiller sorts, runes et objets. Ils s’affichent avec les prochaines stats (calcul toutes les 6 h).", { c: champName(stats, champ), r: ROLE_LABELS[role] })}
              {page?.g ? t(" {n} parties analysées pour l’instant.", { n: int(page.g) }) : ""}</p>
          </section>
        );
        return (<>
          {has.skills && (
            <Card title={t("Ordre des sorts")}
                  sub={t("Priorité {replace} · {share} des parties", { replace: page!.skills![1].replace(/ > /g, " › "), share: share(page!.skills![2], page!.tg) })}>
              <SkillGrid order={page!.skills![0]} />
            </Card>
          )}
          {has.runes && (
            <Card title={t("Runes")} sub={runeSub(stats, champ, role)}>
              <RuneTree stats={stats} champ={champ} role={role} />
            </Card>
          )}
          {row > 0 && (
            <div className="champ__row" style={{ gridTemplateColumns: `repeat(${row}, minmax(0, 1fr))` }}>
              {has.start && (
                <Card title={t("Objets de départ")} sub={t("Les 3 combinaisons les plus jouées")}>
                  <div className="combos combos--stack">
                    {mergeStarts(page!.start).map(([ids, cg, cw]) => (
                      <Combo key={ids} icons={groupIcons(ids)} data={items} wr={cw / cg} pr={cg / page!.tg} />
                    ))}
                  </div>
                </Card>
              )}
              {has.spells && (
                <Card title={t("Sorts d’invocateur")} sub={t("Les 2 combinaisons les plus jouées")}>
                  <div className="combos combos--stack">
                    {page!.spells.map(([a, b, cg, cw]) => (
                      <Combo key={`${a}-${b}`} icons={[[a, 1], [b, 1]]} data={spells} wr={cw / cg} pr={cg / page!.g} />
                    ))}
                  </div>
                </Card>
              )}
              {has.boots && (
                <Card title={t("Bottes")} sub={t("Les 3 plus jouées")}>
                  <div className="cells">
                    {page!.boots.map(([id, bg, bw]) => <Cell key={id} id={id} data={items} wr={bw / bg} pr={bg / page!.g} />)}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>);
      })()}

      {tab === "build" && role === 4 && !!page?.support?.length && (
        <Card title={t("Évolution de l’objet de support")} sub={t("Le choix à faire à la fin de ta quête de support · part des parties où il est choisi")}>
          {page?.support?.length ? (() => {
            const total = page.support.reduce((a, [, g]) => a + g, 0);
            return (
              <div className="evolutions">
                {page.support.map(([id, sg, sw]) => {
                  const tone = wrTone(sw / sg);
                  return (
                    <span key={id} className={`evolution${sg / total < RARE ? " is-rare" : ""}`}>
                      <ItemIcon id={id} data={items} />
                      <span className="evolution__text">
                        <strong>{items?.get(id)?.name ?? t("Objet {id}", { id })}</strong>
                        <small>{t("{n} des parties", { n: pct(sg / total) })}</small>
                      </span>
                      <span className={`evolution__wr tone-${tone}`}>{pct(sw / sg)}<Trend tone={tone} /></span>
                    </span>
                  );
                })}
              </div>
            );
          })() : <p className="muted small">{t("Pas encore assez de parties : les évolutions s’affichent avec les prochaines stats (calcul toutes les 6 h).")}</p>}
        </Card>
      )}

      {tab === "build" && !!page?.items.length && (
      <Card title={t("Objets")} sub={t("Winrate et pickrate selon l’objet acheté en 1er, 2e, 3e… Couleur : par rapport aux autres choix au même rang.")}>
        {page?.items.length ? (
          <div className="item-ranks">
            {page.items.slice(0, ranks).map(([rankGames, list], k) => {
              const total = list.reduce((a, [, ig]) => a + ig, 0);
              const avg = total ? list.reduce((a, [, , iw]) => a + iw, 0) / total : 0;
              return (
                <div key={k} className="item-rank">
                  <span className="item-rank__label">{t("Objet ")}{k + 1}<span>{t("moy. ")}{pct(avg)}</span></span>
                  {list.map(([id, ig, iw]) => (
                    <Cell key={id} id={id} data={items} wr={iw / ig} pr={ig / rankGames}
                          tone={relTone(iw / ig, avg)} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
      )}

      {tab === "build" && !!page?.builds.length && (
      <Card title={t("Builds complets")} sub={t("Les 3 enchaînements de {ranks} objets avec le meilleur winrate, bottes comprises", { ranks: ranks })}>
        {page?.builds.length ? (
          <div className="builds">
            {page.builds.map(([seq, bg, bw]) => (
              <div key={seq.join("-")} className="build">
                <span className="build__items">
                  {withBoots(seq, page).map((id, i) => (
                    <span key={`${id}-${i}`} className="build__step">
                      {i > 0 && <span className="build__arrow" aria-hidden>›</span>}
                      <ItemIcon id={id} data={items} />
                    </span>
                  ))}
                </span>
                <span className="grow" />
                <span className="stat-col">
                  <span className={`stat-col__value tone-${wrTone(bw / bg)}`}>{pct(bw / bg)}<Trend tone={wrTone(bw / bg)} /></span>
                  <span className="stat-col__label">{t("{n} des parties", { n: share(bg, page.tg) })}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
      )}
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
  return t("Meilleure page · {pct} de winrate · {int} parties", { pct: pct(p.wins / p.games), int: int(p.games) });
}

/** « 1056,2003,2003 » -> [[1056, 1], [2003, 2]] */
// Balises de départ (totem, lentille, longue-vue) : elles ne font pas partie du combo. Les stats déjà en ligne
// les comptent encore ; on les retire ici et on fusionne les combos devenus identiques (Doran avec ou sans totem).
const TRINKETS = new Set([3340, 3363, 3364]);
export function mergeStarts(start: [string, number, number][]): [string, number, number][] {
  const merged = new Map<string, [string, number, number]>();
  for (const [ids, g, w] of start) {
    const key = ids.split(",").map(Number).filter((id) => !TRINKETS.has(id)).sort((a, b) => a - b).join(",");
    if (!key) continue;
    const cur = merged.get(key);
    if (cur) { cur[1] += g; cur[2] += w; } else merged.set(key, [key, g, w]);
  }
  return [...merged.values()].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

export function groupIcons(ids: string): [number, number][] {
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
      <span className={`champ__stat${tone ? ` tone-${tone}` : ""}`}>{value}<Trend tone={tone} /></span>
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

export function ItemIcon({ id, data, size = "md" }: { id: number; data: InfoMap | null; size?: "md" | "sm" }) {
  const info = data?.get(id);
  const [failed, setFailed] = useState(false);
  const inButton = useContext(InButton);
  return (
    <span className={`item-ic item-ic--${size}`} tabIndex={inButton ? undefined : 0} aria-hidden={inButton || undefined} aria-label={info?.name ?? t("Objet {id}", { id: id })}>
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
      <span className={`cell__wr tone-${tone ?? wrTone(wr)}`}>{pct(wr)}<Trend tone={tone ?? wrTone(wr)} /></span>
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
        <span className={`stat-col__value tone-${wrTone(wr)}`}>{pct(wr)}<Trend tone={wrTone(wr)} /></span>
        <span className="stat-col__label">{t("{n} des parties", { n: pct(pr) })}</span>
      </span>
    </span>
  );
}

/** Grille niveaux × sorts : la case du sort monté à chaque niveau est remplie. */
export function SkillGrid({ order, current, spent }: { order: string; current?: number; spent?: number | null }) {
  // en partie : seule la case du sort à monter est encadrée (le prochain point dans l'ordre), les niveaux à venir sont atténués
  const next = current == null ? -1 : spent == null ? current - 1 : spent < current ? spent : -1;
  const col = (i: number, on: boolean) => current == null ? "" : (i === next && on ? " is-now" : "") + (i + 1 > current ? " is-later" : "");
  return (
    <div className="skills" role="table" aria-label={t("Ordre des sorts")}>
      {["Q", "W", "E", "R"].map((s) => (
        <div key={s} className="skills__row" role="row">
          <span className="skills__key">{s}</span>
          {order.split("").map((x, i) => (
            <span key={i} className={`skills__cell${x === s ? (s === "R" ? " is-ult" : " is-on") : ""}${col(i, x === s)}`} role="cell">
              {x === s ? i + 1 : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Build complet avec les bottes les plus jouées, placées au moment où les joueurs Master+ les achètent
 *  (après le 1er objet si cette donnée manque encore). */
function withBoots(seq: number[], page: ChampPage): number[] {
  const boots = page.boots[0]?.[0];
  if (boots == null || seq.includes(boots)) return seq;
  const out = [...seq];
  out.splice(Math.min(page.bootsAt?.[0] ?? 1, out.length), 0, boots);
  return out;
}
