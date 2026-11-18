import { TopBar } from "./TopBar";
import { LengthChart } from "./LengthChart";
import { Fragment, useContext, useState, type ReactNode } from "react";
import {
  ROLE_LABELS, gamesIn, runePageFor, tierLetter, tierScore, type ChampPage, type Stats,
} from "../lib/score";
import { champName, int, patchLabel, pct, pctN, wrTone } from "../lib/ui";
import { loadItems, loadSpells, useInfo, type InfoMap } from "../lib/ddragon";
import { ChampionIcon } from "./ChampionIcon";
import { InButton } from "./Runes";
import { Rune, useRuneData } from "./Runes";
import { Segmented } from "./Segmented";
import { getLang, ordinal, t } from "../lib/i18n";
import type { Personal } from "../lib/api";
import { ChampionMatchups } from "./ChampionMatchups";

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

  const has = {
    skills: !!page?.skills, runes: !!stats.runes.get(`${champ}|${role}`)?.[0]?.games, start: !!page?.start.length,
    spells: !!page?.spells.length, boots: !!page?.boots.length, items: !!page?.items.length, builds: !!page?.builds.length,
  };
  const name = champName(stats, champ);
  return (
    <div className="content champ cp">
      <TopBar title={<><button className="crumb" onClick={onBack}>← {inGame ? t("Draft") : t("Tier list")}</button><span className="crumb__sep" aria-hidden>/</span>{name}</>}>
        {g > 0 && <span className={`tl2-group__tier tier--${tier}`}>{t("Tier {tier}", { tier })}</span>}
        <span className="grow" />
        {roles.length > 1 && (
          <Segmented className="segmented" role="tablist" aria-label={t("Rôle")}>
            {roles.map((r) => (
              <button key={r} role="tab" aria-selected={r === role} className={r === role ? "is-active" : ""}
                      onClick={() => onRole(r)}>{ROLE_LABELS[r]}<span className="champ__share">{pctN(Math.round(roleShare(r) * 100))}</span></button>
            ))}
          </Segmented>
        )}
        {region}
      </TopBar>

      <header className="cp-head">
        <ChampionIcon stats={stats} champ={champ} size={3.5} />
        {!inGame && (
          <Segmented className="segmented" role="tablist" aria-label={t("Onglets")}>
            {(["build", "matchups"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "is-active" : ""}
                      onClick={() => setTab(k)}>{k === "build" ? t("Build") : t("Matchups")}</button>
            ))}
          </Segmented>
        )}
        <span className="grow" />
        <span className="cp-stat" title={t("{n} parties · Master+ {region} · patch {patch}", { n: int(g), region: regionLabel, patch: patchLabel(stats.meta.patch) })}>
          <strong className={`tone-${wrTone(winrate)}`}>{pct(winrate)}</strong><small>{t("Winrate Master+")}</small></span>
        <span className="cp-stat"><strong>{pct(pickrate)}</strong><small>{t("Pick")}</small></span>
        {banrate != null && <span className="cp-stat"><strong>{pct(banrate)}</strong><small>{t("Ban")}</small></span>}
        {me && meWr != null && (
          <span className="cp-stat cp-stat--me"><strong>{pct(meWr)}</strong><small>{t("Toi · {n} parties", { n: me[0] })}</small></span>
        )}
      </header>

      {tab === "matchups" && !inGame ? <div className="cp-mups"><ChampionMatchups stats={stats} champ={champ} role={role} perso={perso} /></div>
      : !Object.values(has).some(Boolean) ? (
        <section className="cp-card">
          <h2>{t("Builds en cours de collecte")}</h2>
          <p className="muted small">{t("Pas encore assez de parties de {c} en {r} pour conseiller sorts, runes et objets. Ils s’affichent avec les prochaines stats (calcul toutes les 6 h).", { c: name, r: ROLE_LABELS[role] })}
            {page?.g ? t(" {n} parties analysées pour l’instant.", { n: int(page.g) }) : ""}</p>
        </section>
      ) : (
        <div className="cp-cols">
          <div className="cp-col">
            {has.runes && <section className="cp-card"><h2>{t("Runes")}</h2><RuneSummary stats={stats} champ={champ} role={role} /></section>}
            {has.spells && (
              <section className="cp-card">
                <h2>{t("Sorts d’invocateur")}</h2>
                {page!.spells.map(([a, b2, cg, cw]) => (
                  <div key={`${a}-${b2}`} className="cp-line">
                    <span className="cp-line__icons"><ItemIcon id={a} data={spells} /><ItemIcon id={b2} data={spells} /></span>
                    <span className="grow" />
                    <small>{t("{n} des parties", { n: pct(cg / page!.g) })}</small>
                    <strong className={`tone-${wrTone(cw / cg)}`}>{pct(cw / cg)}</strong>
                  </div>
                ))}
              </section>
            )}
            {(has.start || has.boots) && (
              <div className="cp-pair">
                {has.start && (
                  <section className="cp-card">
                    <h2>{t("Départ")}</h2>
                    {mergeStarts(page!.start).map(([ids, cg, cw]) => (
                      <div key={ids} className="cp-line" title={t("{n} des parties", { n: pct(cg / page!.tg) })}>
                        <span className="cp-line__icons">{groupIcons(ids).map(([id, n]) => (
                          <span key={id} className="combo__icon"><ItemIcon id={id} data={items} />{n > 1 && <span className="combo__count">×{n}</span>}</span>))}</span>
                        <span className="grow" />
                        <strong className={`tone-${wrTone(cw / cg)}`}>{pct(cw / cg)}</strong>
                      </div>
                    ))}
                  </section>
                )}
                {has.boots && (
                  <section className="cp-card">
                    <h2>{t("Bottes")}</h2>
                    {page!.boots.map(([id, bg, bw]) => (
                      <div key={id} className={`cp-line${bg / page!.g < RARE ? " is-rare" : ""}`} title={t("{n} des parties", { n: pct(bg / page!.g) })}>
                        <span className="cp-line__icons"><ItemIcon id={id} data={items} /></span>
                        <span className="grow" />
                        <strong className={`tone-${wrTone(bw / bg)}`}>{pct(bw / bg)}</strong>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}
            {has.skills && (
              <section className="cp-card">
                <div className="ig2-card__head">
                  <h2>{t("Ordre des sorts")}</h2>
                  <span className="grow" />
                  <span className="ig2-card__sub">{t("Priorité {v}", { v: page!.skills![1].replace(/ > /g, " › ") })} · {share(page!.skills![2], page!.tg)}</span>
                </div>
                <SkillStrip order={page!.skills![0]} />
              </section>
            )}
            {role === 4 && !!page?.support?.length && (() => {
              const total = page.support.reduce((x, [, sg]) => x + sg, 0);
              return (
                <section className="cp-card">
                  <h2>{t("Évolution de l’objet de support")}</h2>
                  {page.support.map(([id, sg, sw]) => (
                    <div key={id} className={`cp-line${sg / total < RARE ? " is-rare" : ""}`}>
                      <span className="cp-line__icons"><ItemIcon id={id} data={items} /></span>
                      <span className="cp-line__name">{items?.get(id)?.name ?? t("Objet {id}", { id })}</span>
                      <span className="grow" />
                      <small>{pct(sg / total)}</small>
                      <strong className={`tone-${wrTone(sw / sg)}`}>{pct(sw / sg)}</strong>
                    </div>
                  ))}
                </section>
              );
            })()}
          </div>

          <div className="cp-col">
            {has.items && (
              <section className="cp-card">
                <h2>{t("Objets, par ordre d’achat")}</h2>
                <div className="cp-ranks" style={{ gridTemplateColumns: `repeat(${Math.min(ranks, page!.items.length)}, minmax(0, 1fr))` }}>
                  {page!.items.slice(0, ranks).map(([rankGames, list], k) => {
                    const total = list.reduce((x, [, ig]) => x + ig, 0);
                    const avg = total ? list.reduce((x, [, , iw]) => x + iw, 0) / total : 0;
                    return (
                      <div key={k} className="cp-rank" title={`${t("moy. ")}${pct(avg)}`}>
                        <h3>{getLang() === "en" ? `${ordinal(k + 1)} item` : `${ordinal(k + 1)} objet`}</h3>
                        {list.map(([id, ig, iw]) => (
                          <div key={id} className={`cp-line${ig / rankGames < RARE ? " is-rare" : ""}`}>
                            <ItemIcon id={id} data={items} />
                            <strong className={`tone-${relTone(iw / ig, avg)}`}>{pct(iw / ig)}</strong>
                            <span className="grow" />
                            <small>{pctN(Math.round((ig / rankGames) * 100))}</small>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {has.builds && (
              <section className="cp-card">
                <h2>{t("Builds complets")}</h2>
                {page!.builds.map(([seq, bg, bw]) => (
                  <div key={seq.join("-")} className="cp-line cp-build">
                    {withBoots(seq, page!).map((id, i) => (
                      <Fragment key={`${id}-${i}`}>
                        {i > 0 && <span className="cp-build__arrow" aria-hidden>›</span>}
                        <ItemIcon id={id} data={items} />
                      </Fragment>
                    ))}
                    <span className="grow" />
                    <small>{t("{n} des parties", { n: share(bg, page!.tg) })}</small>
                    <strong className={`tone-${wrTone(bw / bg)}`}>{pct(bw / bg)}</strong>
                  </div>
                ))}
              </section>
            )}
            {(page?.length?.length ?? 0) >= 2 && (
              <section className="cp-card">
                <h2>{t("Winrate selon la durée de la partie")}</h2>
                <LengthChart points={page!.length!} height={150} />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Meilleure page de runes : la rune clé en grand, puis les runes et fragments sur une ligne. */
function RuneSummary({ stats, champ, role }: { stats: Stats; champ: number; role: number }) {
  const data = useRuneData(stats.ddragon);
  const found = runePageFor(stats, champ, role);
  if (!found) return <p className="muted small">{t("Pas encore assez de parties pour conseiller des runes.")}</p>;
  const { page } = found;
  return (
    <>
      <div className="cp-rune">
        <Rune data={data} id={page.keystone} size="key" />
        <span><strong>{data?.get(page.keystone)?.name ?? ""}</strong>
          <small>{page.games ? t("{pct} de winrate · {int} parties", { pct: pct(page.wins / page.games), int: int(page.games) }) : ""}</small></span>
      </div>
      <div className="runes__row">
        {page.primary.map((r) => <Rune key={`p${r}`} data={data} id={r} size="minor" />)}
        <span className="runes__sep" />
        {page.sub.map((r) => <Rune key={`s${r}`} data={data} id={r} size="minor" />)}
        <span className="runes__sep" />
        {page.shards.map((r, i) => <Rune key={`f${i}`} data={data} id={r} size="shard" />)}
      </div>
    </>
  );
}

/** Ordre des sorts sur une ligne : une case par niveau. En partie, `now` est la case du point à dépenser. */
export function SkillStrip({ order, now = -1, level }: { order: string; now?: number; level?: number }) {
  return (
    <div className="ig2-skills" role="list" aria-label={t("Ordre des sorts")} style={{ gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))` }}>
      {order.split("").map((k, i) => (
        <span key={i} role="listitem"
              className={`ig2-skill${k === "R" ? " is-ult" : ""}${i === now ? " is-now" : ""}${level != null && i < (now >= 0 ? now : level) ? " is-past" : ""}`}>
          <strong>{k}</strong><small>{i + 1}</small>
        </span>
      ))}
    </div>
  );
}

const share = (part: number, total: number) => (total ? pct(part / total) : "—");

function relTone(wr: number, avg: number): "good" | "bad" | "neutral" {
  return wr - avg >= RELATIVE ? "good" : avg - wr >= RELATIVE ? "bad" : "neutral";
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
export function withBoots(seq: number[], page: ChampPage): number[] {
  const boots = page.boots[0]?.[0];
  if (boots == null || seq.includes(boots)) return seq;
  const out = [...seq];
  out.splice(Math.min(page.bootsAt?.[0] ?? 1, out.length), 0, boots);
  return out;
}
