import type { ReactNode } from "react";
import { adaptationsFor } from "../lib/adapt";
import type { Situation } from "../lib/composition";
import { loadItems, loadSpells, useInfo, type InfoMap } from "../lib/ddragon";
import { getLang, t } from "../lib/i18n";
import { champIdOf, clock, POSITION_ROLE, useGameClock, type LiveGame } from "../lib/live";
import { ROLE_LABELS, type ChampPage, type Stats } from "../lib/score";
import { champName, int, patchLabel, pct } from "../lib/ui";
import { SITUATION_LABEL } from "./Adaptations";
import { ChampionIcon } from "./ChampionIcon";
import { groupIcons, ItemIcon, mergeStarts, SkillGrid } from "./ChampionScreen";

interface Props {
  stats: Stats;
  champ: number;
  role: number;
  /** Champions adverses connus à la fin de la draft (remplacés par ceux de la partie dès qu'elle est chargée). */
  enemies: number[];
  game: LiveGame | null;
  compact?: boolean;
}

const TRINKETS = new Set([3340, 3363, 3364]);
const VS_MIN_GAMES = 30;   // sorts d'invocateur propres au vis-à-vis à partir de ce nombre de parties
const MAX_ADAPT = 3;

interface Step { id: number; state: "done" | "next" | "later" }

/** Ce que la draft a laissé : ton champion verrouillé, ton rôle et les adversaires (vide si Spec a été ouvert en pleine partie). */
export interface GameStart { champ: number | null; role: number | null; enemies: number[] }

/** Menu de build en partie : champion et rôle pris dans la partie dès qu'elle est chargée, sinon ceux de la draft. */
export function InGameView({ stats, start, game, compact = false }: { stats: Stats; start: GameStart; game: LiveGame | null; compact?: boolean }) {
  const champ = champIdOf(stats, game?.champion ?? null) ?? start.champ;
  const role = (game?.position ? POSITION_ROLE[game.position] : undefined) ?? start.role ?? 2;
  if (champ == null) {
    return (
      <div className="content"><div className="empty-state"><div className="spinner" />
        <h1>{t("Chargement de la partie")}</h1>
        <p className="muted">{t("Ton build s’affiche dès la fin de l’écran de chargement.")}</p>
      </div></div>
    );
  }
  return <InGameScreen stats={stats} champ={champ} role={role} enemies={start.enemies} game={game} compact={compact} />;
}

/** Menu de build pendant la partie : ordre des sorts, départ, bottes, build et objets face à l'équipe adverse. */
export function InGameScreen({ stats, champ, role, enemies, game, compact = false }: Props) {
  const items = useInfo(loadItems, stats.ddragon);
  const spells = useInfo(loadSpells, stats.ddragon);
  const page = stats.champPages.get(`${champ}|${role}`) ?? null;

  const liveEnemies = game?.enemies.map((e) => ({ id: champIdOf(stats, e.champion), role: POSITION_ROLE[e.position] }));
  const foes = liveEnemies ? liveEnemies.map((e) => e.id).filter((c): c is number => c != null) : enemies;
  const opponent = liveEnemies?.find((e) => e.role === role)?.id ?? null;
  const owned = game ? game.items.filter((id) => !TRINKETS.has(id)) : [];

  const steps = buildSteps(page, owned);
  const next = steps.find((s) => s.state === "next") ?? null;
  const name = (id: number) => items?.get(id)?.name ?? t("Objet {id}", { id });
  const adapts = adaptItems(stats, champ, role, foes, items, steps, owned);
  const boots = bootChoice(stats, page, champ, role, foes, items);

  return (
    <div className={`content ingame${compact ? " ingame--compact" : ""}`}>
      <header className="ingame__head">
        <ChampionIcon stats={stats} champ={champ} size={compact ? 2.75 : 3.5} round />
        <div className="ingame__title">
          <h1>{champName(stats, champ)} · {ROLE_LABELS[role]}</h1>
          <p className="muted small">
            {opponent != null ? t("Contre {v} · ", { v: champName(stats, opponent) }) : ""}{t("Patch {v}", { v: patchLabel(stats.meta.patch) })}
          </p>
        </div>
        <span className="ingame__pill"><span className="dot" /><GameClock game={game} /></span>
      </header>

      <Card title={t("Ordre des sorts")}
            sub={page?.skills ? t("Priorité {replace} · {share} des parties", { replace: page.skills[1].replace(/ > /g, " › "), share: page.tg ? pct(page.skills[2] / page.tg) : "—" }) : undefined}>
        {page?.skills ? <SkillGrid order={page.skills[0]} current={game?.level} /> : <Collecting />}
      </Card>

      <div className="ingame__grid">
        <Card title={t("Départ")}>
          <Start page={page} items={items} spells={spells} opponent={opponent} compact={compact} />
        </Card>

        {!compact && (
          <Card title={t("Bottes")}>
            {boots ? (
              <div className="ingame__pair">
                <Named icon={<ItemIcon id={boots.main} data={items} />} title={name(boots.main)} sub={t("Recommandées")} accent />
                {boots.alt && <Named icon={<ItemIcon id={boots.alt.id} data={items} />} title={name(boots.alt.id)} sub={boots.alt.why} />}
              </div>
            ) : <Collecting />}
          </Card>
        )}

        <Card title={t("Build")}>
          {steps.length ? (
            <>
              <div className="ingame__path">
                {steps.map((s, i) => (
                  <span key={`${s.id}-${i}`} className="ingame__step">
                    {i > 0 && <span className="ingame__arrow" aria-hidden>›</span>}
                    <span className={`ingame__item is-${s.state}`}>
                      <ItemIcon id={s.id} data={items} />
                      <small>{s.state === "done" ? t("Fait") : s.state === "next" ? t("Ensuite") : ordinal(i + 1)}</small>
                    </span>
                  </span>
                ))}
              </div>
              {compact && boots?.alt && (
                <p className="ingame__note"><ItemIcon id={boots.alt.id} data={items} size="sm" />{t("{item} : {why}", { item: name(boots.alt.id), why: lower(boots.alt.why) })}</p>
              )}
              {!compact && next && game && (
                <p className="ingame__next">
                  <span className="muted">{t("Prochain objet")}</span><strong>{name(next.id)}</strong>
                  <span className="grow" />
                  <GoldLeft id={next.id} items={items} owned={owned} gold={game.gold} />
                </p>
              )}
            </>
          ) : <Collecting />}
        </Card>

        <Card title={t("Face à leur équipe")}>
          {adapts.length ? (
            <div className="ingame__list">
              {adapts.map((a) => <Named key={a.id} icon={<ItemIcon id={a.id} data={items} />} title={name(a.id)} sub={a.why} />)}
            </div>
          ) : <p className="muted small">{foes.length < 3 ? t("S’affiche quand l’équipe adverse est connue.") : t("Rien à adapter de net face à cette équipe : garde ton build.")}</p>}
        </Card>
      </div>
    </div>
  );
}

/** Seul le chrono se redessine chaque seconde, pas tout le menu. */
function GameClock({ game }: { game: LiveGame | null }) {
  const time = useGameClock(game);
  return <>{time != null ? t("En partie · {v}", { v: clock(time) }) : t("Chargement de la partie")}</>;
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card champ__card ingame__card">
      <div>
        <h2>{title}</h2>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Collecting() {
  return <p className="muted small">{t("Collecte en cours : pas encore assez de parties sur ce champion.")}</p>;
}

function Named({ icon, title, sub, accent = false }: { icon: ReactNode; title: string; sub: string; accent?: boolean }) {
  return (
    <span className={`ingame__named${accent ? " is-accent" : ""}`}>
      {icon}
      <span className="ingame__named-text"><strong>{title}</strong><small>{sub}</small></span>
    </span>
  );
}

/** Objets de départ (la combinaison la plus jouée) et sorts d'invocateur (face à ton vis-à-vis s'il y a assez de parties). */
function Start({ page, items, spells, opponent, compact }: { page: ChampPage | null; items: InfoMap | null; spells: InfoMap | null; opponent: number | null; compact: boolean }) {
  const start = page ? mergeStarts(page.start)[0] : undefined;
  const vs = opponent != null ? page?.spellsVs?.filter((s) => s[0] === opponent && s[3] >= VS_MIN_GAMES).sort((a, b) => b[3] - a[3])[0] : undefined;
  const pair = vs ? [vs[1], vs[2]] : page?.spells[0] ? [page.spells[0][0], page.spells[0][1]] : null;
  if (!start && !pair) return <Collecting />;
  const nameOf = (data: InfoMap | null, id: number) => data?.get(id)?.name ?? "";
  const groups = start ? groupIcons(start[0]) : [];
  const [main, ...rest] = groups;
  // petite fenêtre : « Anneau de Doran » → « Doran », « 2 × Potion de soin » → « 2 potions »
  const short = (s: string) => (compact ? s.split(" ").slice(-1)[0] : s);
  const restText = rest.map(([id, n]) => {
    const nm = nameOf(items, id);
    if (!compact) return n > 1 ? `${n} × ${nm}` : nm;
    const w = nm.split(" ")[0].toLowerCase();
    return n > 1 ? `${n} ${w}s` : w;
  }).join(" + ");
  return (
    <div className="ingame__pair">
      {main && (
        <Named icon={<span className="ingame__icons">{groups.map(([id, n]) => (
                   <span key={id} className="combo__icon"><ItemIcon id={id} data={items} />{n > 1 && <span className="combo__count">×{n}</span>}</span>))}</span>}
               title={short(nameOf(items, main[0]))} sub={restText ? `+ ${restText}` : ""} />
      )}
      {main && pair && <span className="ingame__sep" aria-hidden />}
      {pair && (
        <Named icon={<span className="ingame__icons"><ItemIcon id={pair[0]} data={spells} /><ItemIcon id={pair[1]} data={spells} /></span>}
               title={nameOf(spells, pair[0])} sub={`+ ${nameOf(spells, pair[1])}`} />
      )}
    </div>
  );
}

/** Chemin d'objets du meilleur build complet, avec ce que tu as déjà acheté. */
function buildSteps(page: ChampPage | null, owned: number[]): Step[] {
  let seq = page?.builds[0]?.[0];
  if (!seq?.length && page?.items.length) {
    // pas encore de build complet : l'objet le plus acheté à chaque rang, sans doublon
    seq = [];
    for (const [, list] of page.items.slice(0, 6)) {
      const best = [...list].sort((a, b) => b[1] - a[1]).find(([id]) => !seq!.includes(id));
      if (best) seq.push(best[0]);
    }
  }
  if (!seq) return [];
  const have = new Set(owned);
  let nextSet = false;
  return seq.map((id) => {
    if (have.has(id)) return { id, state: "done" };
    if (!nextSet) { nextSet = true; return { id, state: "next" }; }
    return { id, state: "later" };
  });
}

/** Bottes les plus jouées et, s'il y en a, l'alternative que les joueurs Master+ prennent face à ce type d'équipe. */
function bootChoice(stats: Stats, page: ChampPage | null, champ: number, role: number, foes: number[], items: InfoMap | null) {
  if (!page?.boots.length) return null;
  const main = page.boots[0][0];
  for (const a of adaptationsFor(stats, champ, role, foes)) {
    const b = a.items.find(([id]) => items?.get(id)?.boots && id !== main);
    if (b) return { main, alt: { id: b[0], why: situationWhy(a.situation) } };
  }
  const second = page.boots[1];
  return { main, alt: second ? { id: second[0], why: t("Pris dans {v} des parties", { v: pct(second[1] / page.g) }) } : null };
}

/** Objets à adapter face à l'équipe adverse (sans les bottes, déjà dans leur carte). */
function adaptItems(stats: Stats, champ: number, role: number, foes: number[], items: InfoMap | null, steps: Step[], owned: number[]) {
  const out: { id: number; why: string }[] = [];
  const nextAt = steps.findIndex((s) => s.state === "next");
  for (const a of adaptationsFor(stats, champ, role, foes)) {
    for (const [id] of a.items) {
      if (out.length >= MAX_ADAPT || out.some((o) => o.id === id) || owned.includes(id) || items?.get(id)?.boots) continue;
      const at = steps.findIndex((s) => s.id === id);
      // déjà prévu plus tard dans le build : on conseille de le monter juste après le prochain objet
      const earlier = at > nextAt + 1 && nextAt >= 0 ? t(" · à prendre en {v}", { v: ordinal(nextAt + 2) }) : "";
      if (at >= 0 && !earlier) continue;
      out.push({ id, why: SITUATION_LABEL[a.situation]() + earlier });
    }
  }
  return out;
}

function situationWhy(s: Situation): string {
  return t("Si {v}", { v: lower(SITUATION_LABEL[s]()) });
}

/** Or qu'il te manque pour le prochain objet, en comptant ses composants déjà achetés. */
function GoldLeft({ id, items, owned, gold }: { id: number; items: InfoMap | null; owned: number[]; gold: number }) {
  const info = items?.get(id);
  if (!info?.gold) return null;
  const pool = [...owned];
  let have = 0;
  for (const c of info.from ?? []) {
    const k = pool.indexOf(c);
    if (k >= 0) { have += items?.get(c)?.gold ?? 0; pool.splice(k, 1); }
  }
  const left = Math.max(0, info.gold - have - Math.floor(gold));
  return left === 0
    ? <span className="tone-good small">{t("Tu peux l’acheter")}</span>
    : <span className="tone-warn small">{t("{v} PO restants", { v: int(left) })}</span>;
}

const ordinal = (n: number) => {
  if (getLang() !== "en") return n === 1 ? "1er" : `${n}e`;
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
