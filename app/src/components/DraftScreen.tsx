import { useEffect, useMemo, useState } from "react";
import {
  LOW_DATA_GAMES, ROLE_LABELS, ROLE_SHORT, banSuggestions, enemyDisplay, explain, recommend, roleDistribution,
  scoreChampion, topForRole, type Result, type Stats,
} from "../lib/score";
import { RunePage } from "./Runes";
import { champName, int, patchLabel, pct, pctN, pts, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import type { PersonalState } from "../lib/api";
import { ChampionPicker } from "./ChampionPicker";
import { Segmented } from "./Segmented";
import { Trend } from "./Trend";
import { GAP_LABEL, analyzeTeam, bumpForComposition, fills, type Gap, type TeamComp } from "../lib/composition";
import { t, plural } from "../lib/i18n";

export interface Draft {
  role: number;                    // rôle assigné (index dans ROLES)
  allies: (number | null)[];       // 5 emplacements, par rôle ; celui du joueur reste vide
  enemies: (number | null)[];      // 5 emplacements, dans l'ordre des picks
  bans: number[];
  allyLocked?: boolean[];          // en direct : true = lock, false = survol
  myChamp?: number | null;         // ton champion, survolé ou verrouillé
  myLocked?: boolean;
  banPhase?: boolean;              // il te reste un ban à faire
}

interface Props {
  stats: Stats;
  draft: Draft;
  pool: number[];
  wide: boolean;
  onChange: (d: Draft) => void;
  onEnd?: () => void;
  /** En direct : draft lue dans le client (slots non modifiables). */
  live?: boolean;
  /** En direct : présélectionne dans le client, renvoie un message d'erreur ou null. */
  onPreselect?: (champ: number) => Promise<string | null>;
  /** En direct : survole le champion pour ton ban, renvoie un message d'erreur ou null. */
  onBan?: (champ: number) => Promise<string | null>;
  perso?: PersonalState;
}

type Slot = { side: "ally" | "enemy"; index: number } | null;

export function DraftScreen({ stats, draft, pool, wide, onChange, onEnd, live = false, onPreselect, onBan, perso }: Props) {
  const [picking, setPicking] = useState<Slot>(null);
  const [openChamp, setOpenChamp] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { allies, enemies, autofill, rows, team } = useRecos(stats, draft, pool);
  const myComp = useMemo(() => analyzeTeam(stats, draft.myChamp != null ? [...allies, draft.myChamp] : allies), [stats, allies, draft.myChamp]);
  const enemyComp = useMemo(() => analyzeTeam(stats, enemies), [stats, enemies]);

  const selected = rows.find((r) => r.res.champ === openChamp)?.res ?? null;
  // ton champion présélectionné : sa ligne s'ouvre, avec l'explication (pas de carte en double au-dessus)
  const myInList = draft.myChamp != null && rows.some((r) => r.res.champ === draft.myChamp);
  useEffect(() => { if (draft.myChamp != null) setOpenChamp(draft.myChamp); }, [draft.myChamp]);
  const taken = new Set([...allies, ...enemies, ...draft.bans]);
  // adversaires rangés par rôle le plus probable (Top en haut, Support en bas), un seul par rôle
  const enemyRows = useMemo(() => enemyDisplay(stats, draft.enemies), [stats, draft.enemies]);

  const setSlot = (slot: NonNullable<Slot>, champ: number | null) => {
    const next = { ...draft, allies: [...draft.allies], enemies: [...draft.enemies] };
    (slot.side === "ally" ? next.allies : next.enemies)[slot.index] = champ;
    onChange(next);
    setPicking(null);
  };

  const preselect = makePreselect(stats, onPreselect, setNotice,
    live ? undefined : (champ) => onChange({ ...draft, myChamp: champ, myLocked: false }));
  const banSelect = makeBanSelect(stats, live ? onBan : undefined, setNotice);

  return (
    <div className="content">
      <header className="page-head">
        <div>
          <p className="overline">{live ? t("Sélection des champions · en direct") : t("Sélection des champions · mode démo")}</p>
          <h1>{t("Tu joues ")}{ROLE_LABELS[draft.role]}</h1>
        </div>
        <div className="head-actions">
          <Segmented className="segmented" role="tablist" aria-label={t("Rôle assigné")}>
            {ROLE_LABELS.map((label, i) => (
              <button key={label} role="tab" aria-selected={draft.role === i}
                      className={draft.role === i ? "is-active" : ""}
                      onClick={() => { onChange({ ...draft, role: i }); setOpenChamp(null); }}>{label}</button>
            ))}
          </Segmented>
          {!live && (
            <button className={`btn btn--secondary${draft.banPhase ? " is-on" : ""}`} aria-pressed={!!draft.banPhase}
                    onClick={() => onChange({ ...draft, banPhase: !draft.banPhase })}>{t("Phase de bans")}</button>
          )}
          {!live && onEnd && <button className="btn btn--secondary" onClick={onEnd}>{t("Terminer la démo")}</button>}
        </div>
      </header>

      <div className={wide ? "columns" : "stack"}>
        <section className={wide ? "teams teams--column" : "teams"} aria-label={t("Équipes")}>
          <TeamCard title={t("Ton équipe")} comp={<CompSummary comp={myComp} mine />}>
            {draft.allies.map((c, i) => {
              const me = i === draft.role;
              const mine = me ? draft.myChamp ?? null : null;
              return (
                <SlotRow key={i} stats={stats} label={ROLE_SHORT[i]} champ={me ? mine : c}
                         name={me ? (mine != null ? champName(stats, mine) : t("À toi de choisir")) : c == null ? t("En attente") : champName(stats, c)}
                         detail={me ? (mine == null ? t("Ton tour") : draft.myLocked ? t("Lock · toi") : t("Présélectionne · toi"))
                                 : c == null ? (live ? t("Pas encore choisi") : t("Clique pour ajouter un pick"))
                                 : draft.allyLocked && !draft.allyLocked[i] ? t("Présélectionne") : t("Lock")}
                         tone={me ? "me" : c == null ? "empty" : "default"}
                         onClick={me || live ? undefined : () => setPicking({ side: "ally", index: i })} />
              );
            })}
          </TeamCard>
          <TeamCard title={t("Équipe adverse")} comp={<CompSummary comp={enemyComp} mine={false} />}>
            {enemyRows.map(({ index: i, role }) => {
              const c = draft.enemies[i];
              return (
                <SlotRow key={i} stats={stats} label={role != null ? ROLE_SHORT[role] : "—"} champ={c}
                         name={c == null ? t("En attente") : champName(stats, c)}
                         detail={c == null ? (live ? t("Pas encore choisi") : t("Clique pour ajouter un pick")) : rolesText(stats, c)}
                         tone={c == null ? "empty" : "default"}
                         onClick={live ? undefined : () => setPicking({ side: "enemy", index: i })} />
              );
            })}
          </TeamCard>
        </section>

        <section className="recos" aria-label={t("Recommandations")}>
          {draft.banPhase && (
            <>
              <div className="section-head">
                <h2>{t("Bans recommandés")}</h2>
                <span className="muted small">{t("Phase de bans · ")}{ROLE_LABELS[draft.role]}</span>
              </div>
              <BanPanel stats={stats} draft={draft} titled={false} onSelect={banSelect} />
            </>
          )}
          <div className={`section-head${draft.banPhase ? " section-head--spaced" : ""}`}>
            <h2>{draft.myLocked ? t("Ton pick est verrouillé") : autofill ? t("Picks recommandés en autofill {v}", { v: ROLE_LABELS[draft.role] }) : t("Picks recommandés pour toi")}</h2>
            <span className="muted small">
              {t("{n} parties Master+ · patch {patch}", { n: int(Number(stats.meta.matches ?? 0)), patch: patchLabel(stats.meta.patch) })}
            </span>
          </div>
          {draft.myChamp != null && (draft.myLocked || !myInList) && <MyPick stats={stats} draft={draft} />}
          {draft.myLocked && (
            <p className="hint">{t("Plus de présélection à faire : importe tes runes et tes sorts ci-dessus.")}</p>
          )}
          {!draft.myLocked && autofill && (
            <p className="hint">{t("Ton pool est vide pour ce rôle : voici les meilleurs choix de cette draft.")}</p>
          )}
          {!draft.myLocked && (
            <div className="recos__list stagger" key={draft.role}>
              {rows.map(({ res, kind }, i) => (
                <div key={res.champ}>
                  {kind === "discovery" && !autofill && rows[i - 1]?.kind !== "discovery" && <p className="divider-label">{t("Envie de tester ?")}</p>}
                  <RecoRow stats={stats} res={res} rank={kind === "pool" ? String(i + 1) : "—"}
                           discovery={kind === "discovery"} open={openChamp === res.champ}
                           onToggle={() => setOpenChamp(openChamp === res.champ ? null : res.champ)}
                           onPreselect={() => preselect(res.champ)} perso={persoCell(perso, res.champ, draft.role)}
                           role={draft.role} mine={res.champ === draft.myChamp}
                           why={res.champ === draft.myChamp ? explain(stats, res, draft.role, allies) : undefined}
                           fill={fills(stats, res.champ, team)} />
                </div>
              ))}
            </div>
          )}
          {!draft.myLocked && rows.length === 0 && (
            <p className="hint">{t("Pas encore assez de parties pour ce rôle. Laisse tourner le collecteur.")}</p>
          )}
          {wide && selected && !draft.myLocked && <MatchupPanel stats={stats} res={selected} perso={perso} role={draft.role} />}
        </section>
      </div>

      {picking && (
        <ChampionPicker stats={stats} taken={taken}
                        title={picking.side === "ally" ? t("Pick allié · {v}", { v: ROLE_LABELS[picking.index] }) : t("Pick adverse")}
                        canClear={(picking.side === "ally" ? draft.allies : draft.enemies)[picking.index] != null}
                        onPick={(c) => setSlot(picking, c)} onClose={() => setPicking(null)} />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

const ROLE_WORDS = ["top", "jungle", "mid", "ADC", "support"];

/** « Probabilité d'être mid : 46 % · top : 38 % » (deuxième rôle affiché s'il dépasse 15 %). */
function rolesText(stats: Stats, champ: number): string {
  const [first, second] = roleDistribution(stats, champ);
  if (!first) return t("Rôle inconnu");
  const head = t("Probabilité d’être {v} : {round} %", { v: ROLE_WORDS[first.role], round: Math.round(first.p * 100) });
  return second && second.p >= 0.15 ? `${head} · ${ROLE_WORDS[second.role]} ${pctN(Math.round(second.p * 100))}` : head;
}

function TeamCard({ title, children, comp }: { title: string; children: React.ReactNode; comp?: React.ReactNode }) {
  return (
    <div className="card team">
      <div className="team__head"><h3 className="card__title">{title}</h3>{comp}</div>
      {children}
    </div>
  );
}

interface SlotRowProps {
  stats: Stats; label: string; champ: number | null; name: string; detail: string;
  tone: "default" | "me" | "empty"; onClick?: () => void;
}

function SlotRow({ stats, label, champ, name, detail, tone, onClick }: SlotRowProps) {
  return (
    <button className={`slot slot--${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="slot__role">{label}</span>
      <ChampionIcon stats={stats} champ={champ} size={1.75} tone={tone === "me" ? "accent" : "default"} />
      <span className="slot__text">
        <span className="slot__name">{name}</span>
        <span className="slot__detail">{detail}</span>
      </span>
    </button>
  );
}

interface RecoRowProps {
  stats: Stats; res: Result; rank: string; discovery: boolean; open: boolean;
  onToggle: () => void; onPreselect: () => void; compact?: boolean; perso?: PersoCell; role: number;
  /** Ton champion présélectionné : badge et explication dans la ligne. */
  mine?: boolean; why?: string;
  /** Manques de ton équipe que ce champion comble. */
  fill?: Gap[];
}

export function RecoRow({ stats, res, rank, discovery, open, onToggle, onPreselect, compact = false, perso, role, mine = false, why, fill = [] }: RecoRowProps) {
  const laner = res.details[0];
  return (
    <div className={`reco${open ? " is-open" : ""}`}>
      <button className="reco__line" onClick={onToggle} aria-expanded={open}>
        <span className="reco__rank">{rank}</span>
        <ChampionIcon stats={stats} champ={res.champ} size={compact ? 2.125 : 2.5} />
        <span className="reco__info">
          <span className="reco__name">{champName(stats, res.champ)}</span>
          <span className="reco__meta">
            {mine && <span className="badge badge--mine">{t("Présélectionné")}</span>}
            {discovery && <span className="badge">{t("Découverte")}</span>}
            {!compact && (fill.length
              ? <span className="reco__fill" title={t("Ce champion comble ce qui manque à ton équipe")}>{t("Comble : ")}{fill.map((g) => GAP_LABEL[g]).join(" · ")}</span>
              : <span>{discovery ? t("Hors de ton pool") : t("Dans ton pool")}</span>)}
            {res.games < LOW_DATA_GAMES && <span className="warn">{t("Peu de données")}</span>}
            {compact && perso?.short && <span className={`tone-${perso.tone}`}>{perso.short} <Trend tone={perso.tone} /></span>}
          </span>
        </span>
        <span className="reco__stat">
          <span className={`reco__wr tone-${wrTone(res.score)}`}>{pct(res.score)}<Trend tone={wrTone(res.score)} /></span>
          <span className="reco__label">{t("Dans cette draft")}</span>
        </span>
        {!compact && <>
          <span className="reco__sep" />
          <span className="reco__perso">
            <span className={`reco__perso-value tone-${perso?.tone ?? "neutral"}`}>{perso?.value ?? "—"}<Trend tone={perso?.tone} /></span>
            <span className="reco__label">{perso?.label ?? t("Stats perso indisponibles")}</span>
          </span>
        </>}
      </button>
      {open && (
        <div className="reco__detail">
          {why && <p className="mypick__why">{why}</p>}
          <div className="reco__factors">
          {laner && laner.p >= 0.15 && (
            <Factor label={t("Face à {champName} · {round} % d’être ton vis-à-vis", { champName: champName(stats, laner.enemy), round: Math.round(laner.p * 100) })}
                    value={res.lane} />
          )}
          <Factor label={t("Contre le reste de l’équipe")} value={res.counters} />
          <Factor label={t("Avec tes alliés")} value={res.synergies} />
          </div>
          <RunePage stats={stats} champ={res.champ} role={role} laner={laner && laner.p >= 0.5 ? laner.enemy : null} />
          {!mine && <button className="btn btn--primary" onClick={onPreselect}>{t("Présélectionner dans le client")}</button>}
        </div>
      )}
    </div>
  );
}

function Factor({ label, value }: { label: string; value: number }) {
  return (
    <span className="factor">
      {label} <strong className={`tone-${value > 0.0005 ? "good" : value < -0.0005 ? "bad" : "neutral"}`}>{pts(value)}<Trend tone={value > 0.0005 ? "good" : value < -0.0005 ? "bad" : "neutral"} /></strong>
    </span>
  );
}

function MatchupPanel({ stats, res, perso, role }: { stats: Stats; res: Result; perso?: PersonalState; role: number }) {
  const laner = res.details[0];
  const risk = [...res.details].sort((a, b) => a.counterDelta - b.counterDelta)[0];
  return (
    <div className="card matchup">
      <div className="matchup__head">
        <ChampionIcon stats={stats} champ={res.champ} size={2.5} />
        {laner && <><span className="muted">vs</span><ChampionIcon stats={stats} champ={laner.enemy} size={2.5} /></>}
        <div>
          <h3>{champName(stats, res.champ)}{laner ? t(" face à {champName}", { champName: champName(stats, laner.enemy) }) : ""}</h3>
          <p className="muted small">
            {laner ? t("Matchup de la ligne sélectionnée · {round} % d’être ton vis-à-vis", { round: Math.round(laner.p * 100) })
                   : t("Aucun ennemi visible pour l’instant")}
          </p>
        </div>
      </div>
      <div className="tiles">
        <Tile label={t("Master+ sur ce matchup")}
              value={laner && laner.games > 0 ? pct(laner.wins / laner.games) : "—"}
              detail={laner ? t("{int} parties ce patch", { int: int(laner.games) }) : t("En attente du vis-à-vis")} />
        <Tile label={t("Ton bilan face à ce champion")} {...matchupTile(stats, perso, res.champ, role, laner?.enemy)} />
        <Tile label={t("Plus gros risque de la draft")}
              value={risk && risk.counterDelta < -0.0005 ? champName(stats, risk.enemy) : t("Aucun")}
              detail={risk && risk.counterDelta < -0.0005 ? pts(risk.counterDelta) : t("Pas d’ennemi défavorable")}
              tone={risk && risk.counterDelta < -0.0005 ? "warn" : undefined} />
      </div>
    </div>
  );
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "warn" }) {
  return (
    <div className="tile-stat">
      <span className="tile-stat__label">{label}</span>
      <span className={`tile-stat__value${tone ? " tone-warn" : ""}`}>{value}</span>
      <span className="tile-stat__detail">{detail}</span>
    </div>
  );
}

export type RecoItem = { res: Result; kind: "pool" | "discovery" };

/** Recommandations de la draft : pool d'abord, puis une découverte (ou le top du rôle en autofill). */
export function useRecos(stats: Stats, draft: Draft, pool: number[]) {
  return useMemo(() => {
    const allies = draft.allies.filter((c, i): c is number => c != null && i !== draft.role);
    const enemies = draft.enemies.filter((c): c is number => c != null);
    const r = recommend(stats, draft.role, pool, allies, enemies, draft.bans);
    const autofill = r.pool.length === 0;
    // composition de ton équipe sans toi : un pick qui comble un manque gagne au plus une place
    const team = analyzeTeam(stats, allies);
    const bump = (list: Result[]) => bumpForComposition(stats, list.map((res) => ({ champ: res.champ, res })), team).map((x) => x.res);
    const rows: RecoItem[] = autofill
      ? bump(topForRole(stats, draft.role, allies, enemies, draft.bans, 6)).map((res) => ({ res, kind: "discovery" as const }))
      : [...bump(r.pool).map((res) => ({ res, kind: "pool" as const })),
         ...bump(r.discoveries).map((res) => ({ res, kind: "discovery" as const }))];
    return { allies, enemies, autofill, rows, team };
  }, [stats, draft, pool]);
}

/** Présélection avec un message de confirmation (ou d'erreur) affiché quelques secondes. */
export function makePreselect(
  stats: Stats,
  onPreselect: ((champ: number) => Promise<string | null>) | undefined,
  setNotice: React.Dispatch<React.SetStateAction<string | null>>,
  onDemoPick?: (champ: number) => void,
) {
  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((m) => (m === msg ? null : m)), 3500);
  };
  return async (champ: number) => {
    if (!onPreselect) {
      onDemoPick?.(champ);
      flash(t("Démo : {champName} est survolé comme dans le client.", { champName: champName(stats, champ) }));
      return;
    }
    const error = await onPreselect(champ);
    flash(error ?? t("{champName} présélectionné dans le client. À toi de le verrouiller.", { champName: champName(stats, champ) }));
  };
}

/** Clic sur un ban conseillé : le survole dans le client (sans valider), avec un message. */
export function makeBanSelect(
  stats: Stats,
  onBan: ((champ: number) => Promise<string | null>) | undefined,
  setNotice: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((m) => (m === msg ? null : m)), 3500);
  };
  return async (champ: number) => {
    if (!onBan) {
      flash(t("Démo : en partie, {champName} serait survolé pour ton ban.", { champName: champName(stats, champ) }));
      return;
    }
    const error = await onBan(champ);
    flash(error ?? t("{champName} survolé pour ton ban. À toi de valider dans le client.", { champName: champName(stats, champ) }));
  };
}

type Tone = "good" | "bad" | "neutral";
export interface PersoCell { value: string; label: string; tone: Tone; short?: string }

const games = (n: number) => plural(n, "{n} partie", "{n} parties").replace(String(n), int(n));
const persoTone = (g: number, w: number): Tone => (g >= 5 ? wrTone(w / g) : "neutral");

/** Colonne « toi » d'une recommandation : winrate de la saison dans ce rôle (ou toutes lanes). */
export function persoCell(perso: PersonalState | undefined, champ: number, role: number): PersoCell {
  if (!perso || perso.kind === "off") return { value: "—", label: t("Stats perso indisponibles"), tone: "neutral" };
  if (perso.kind === "no-account") return { value: "—", label: t("Lance le client LoL"), tone: "neutral" };
  if (perso.kind === "unregistered") return { value: "—", label: t("À activer dans ton profil"), tone: "neutral" };
  if (perso.kind === "loading") return { value: "—", label: t("Chargement…"), tone: "neutral" };
  if (perso.kind === "error") return { value: "—", label: t("Serveur injoignable"), tone: "neutral" };
  const d = perso.data;
  const [g, w] = d.byRole.get(`${champ}:${role}`) ?? [0, 0];
  if (g > 0) return { value: pct(w / g), label: t("Toi · {games}", { games: games(g) }), tone: persoTone(g, w), short: t("Toi {pct} · {g}", { pct: pct(w / g), g: g }) };
  const [ga, wa] = d.byChamp.get(champ) ?? [0, 0];
  if (ga > 0) return { value: pct(wa / ga), label: t("Toi, autres lanes · {games}", { games: games(ga) }), tone: persoTone(ga, wa) };
  if (d.syncing && d.matches === 0) return { value: "—", label: t("Synchro en cours"), tone: "neutral" };
  return { value: "—", label: t("Jamais joué cette saison"), tone: "neutral" };
}

function matchupTile(stats: Stats, perso: PersonalState | undefined, champ: number, role: number, enemy: number | undefined) {
  if (enemy == null) return { value: "—", detail: t("En attente du vis-à-vis") };
  if (!perso || perso.kind !== "ready") {
    const why = perso?.kind === "unregistered" ? t("Active tes stats perso dans ton profil")
      : perso?.kind === "no-account" ? t("Lance le client LoL") : t("Stats perso indisponibles");
    return { value: "—", detail: why };
  }
  const [g, w] = perso.data.matchups.get(`${champ}:${role}:${enemy}`) ?? [0, 0];
  if (g === 0) return { value: "—", detail: t("Jamais affronté {champName} avec ce champion cette saison", { champName: champName(stats, enemy) }) };
  return { value: `${w} V – ${g - w} D`, detail: t("{pct} sur {games} cette saison", { pct: pct(w / g), games: games(g) }) };
}

/** Ton champion survolé ou verrouillé : son score dans la draft, pourquoi, et ses runes. */
export function MyPick({ stats, draft, compact = false }: { stats: Stats; draft: Draft; compact?: boolean }) {
  const champ = draft.myChamp!;
  const allies = draft.allies.filter((c, i): c is number => c != null && i !== draft.role);
  const enemies = draft.enemies.filter((c): c is number => c != null);
  const res = scoreChampion(stats, champ, draft.role, allies, enemies);
  const laner = res.details[0];
  return (
    <div className={`card mypick${compact ? " mypick--compact" : ""}`} aria-live="polite">
      <div className="mypick__head">
        <ChampionIcon stats={stats} champ={champ} size={compact ? 2.125 : 2.5} />
        <div className="grow">
          <p className="overline">{draft.myLocked ? t("Ton pick") : t("Ta présélection")}</p>
          <p className="mypick__name">{champName(stats, champ)}</p>
        </div>
        <span className="reco__stat">
          <span className={`reco__wr tone-${wrTone(res.score)}`}>{pct(res.score)}<Trend tone={wrTone(res.score)} /></span>
          <span className="reco__label">{t("Dans cette draft")}</span>
        </span>
      </div>
      <p className="mypick__why">{explain(stats, res, draft.role, allies)}</p>
      <RunePage stats={stats} champ={champ} role={draft.role} laner={laner && laner.p >= 0.5 ? laner.enemy : null} />
    </div>
  );
}

/** Phase de bans : 3 champions à bannir. */
export function BanPanel({ stats, draft, compact = false, titled = true, onSelect }:
  { stats: Stats; draft: Draft; compact?: boolean; titled?: boolean; onSelect?: (champ: number) => void }) {
  const taken = [...draft.allies, ...draft.enemies].filter((c): c is number => c != null).concat(draft.bans);
  const list = banSuggestions(stats, draft.role, draft.myChamp ?? null, taken);
  if (!list.length) return null;
  const counters = list.filter((b) => b.against).length;
  const me = champName(stats, draft.myChamp ?? null);
  const role = ROLE_LABELS[draft.role];
  const intro = draft.myChamp == null ? t("Pas de présélection : les meilleurs winrates en {role}", { role: role })
    : counters === list.length ? t("Les matchups que {me} perd le plus en {role}", { me: me, role: role })
    : counters > 0 ? t("Les matchups que {me} perd, puis les plus forts en {role}", { me: me, role: role })
    : t("{me} n’a pas de matchup nettement perdant : les meilleurs winrates en {role}", { me: me, role: role });
  return (
    <div className={`card bans${compact ? " bans--compact" : ""}`}>
      {titled && <p className="bans__title">{t("Bans recommandés")}</p>}
      <p className="muted small">
        {intro}
      </p>
      <div className="bans__list">
        {list.map((b) => (
          <button key={b.champ} className="bans__item" onClick={() => onSelect?.(b.champ)} disabled={!onSelect}
                  title={t("Survoler {champName} pour ton ban", { champName: champName(stats, b.champ) })}>
            <ChampionIcon stats={stats} champ={b.champ} size={compact ? 1.75 : 2} />
            <span className="bans__text">
              <span className="bans__name">{champName(stats, b.champ)}</span>
              <span className="muted small">
                {b.against ? t("Tu gagnes {pct} contre lui", { pct: pct(b.winrate) }) : t("{pct} de winrate en {role}", { pct: pct(b.winrate), role: role })} · {t("{n} parties", { n: int(b.games) })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Composition d'une équipe en une ligne : barre AD/AP et manques ; le détail s'affiche au survol. */
function CompSummary({ comp, mine }: { comp: TeamComp; mine: boolean }) {
  if (comp.known < 2) return null;
  const ad = Math.round(comp.ad * 100), ap = 100 - ad;
  const dmgIssue = comp.issues.find((i) => i.gap === "ap" || i.gap === "ad");
  const others = comp.issues.filter((i) => i !== dmgIssue && (mine || i.level === "bad"));
  const dmgText = dmgIssue ? dmgIssue.short : ad >= 60 ? `${pctN(ad)} AD` : ap >= 60 ? `${pctN(ap)} AP` : t("AD / AP équilibré");
  return (
    <span className="comp" tabIndex={0} aria-label={t("Composition : {dmgText}{v}", { dmgText: dmgText, v: others.length ? t(", manque : {list}", { list: others.map((i) => i.short).join(", ") }) : "" })}>
      <span className="comp__bar" aria-hidden><span className="comp__ad" style={{ width: `${ad}%` }} /><span className="comp__ap" /></span>
      <span className={`comp__dmg${dmgIssue ? " tone-bad" : ""}`}>{dmgText}</span>
      {mine && others.slice(0, 2).map((i) => (
        <span key={i.gap} className={`comp__chip comp__chip--${i.level}`}>✕ {i.short}</span>
      ))}
      <span className="comp__pop" role="tooltip">
        <strong>{mine ? t("Composition de ton équipe") : t("Composition adverse")}</strong>
        {comp.issues.length === 0 && <span className="comp__line"><b className="tone-good">✓</b>{t("Rien ne manque pour l’instant.")}</span>}
        {comp.issues.map((i) => (
          <span key={i.gap} className="comp__line"><b className={i.level === "bad" ? "tone-bad" : "tone-warn"}>{i.level === "bad" ? "✕" : "~"}</b>{i.text}</span>
        ))}
        {mine && comp.issues.length > 0 && <small>{t("Les picks qui comblent ces manques sont marqués « Comble : … ».")}</small>}
      </span>
    </span>
  );
}
