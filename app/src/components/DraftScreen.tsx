import { useEffect, useMemo, useState } from "react";
import {
  LOW_DATA_GAMES, ROLE_LABELS, banSuggestions, type BanSuggestion, draftGain, explain, isBlind, recommend,
  scoreChampion, topForRole, type Result, type Stats,
} from "../lib/score";
import { RunePage } from "./Runes";
import { MatchupNote } from "./MatchupNote";
import { champName, dec1, int, patchLabel, pct, pts, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import type { PersonalState } from "../lib/api";
import { ChampionPicker } from "./ChampionPicker";
import { Segmented } from "./Segmented";
import { Trend } from "./Trend";
import { DraftBand } from "./DraftBand";
import { GAP_LABEL, analyzeTeam, bumpForComposition, fills, type Gap } from "../lib/composition";
import { t, plural } from "../lib/i18n";

export interface Draft {
  role: number;                    // rôle assigné (index dans ROLES)
  allies: (number | null)[];       // 5 emplacements, par rôle ; celui du joueur reste vide
  enemies: (number | null)[];      // 5 emplacements, dans l'ordre des picks
  bans: number[];
  allyBans?: number[];             // en direct : bans de chaque équipe (sinon tous dans `bans`)
  enemyBans?: number[];
  allyPicking?: number | null;     // en direct : allié (index de rôle) en train de choisir
  enemyPicking?: number | null;    // en direct : adversaire (ordre des picks) en train de choisir
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

  const { allies, enemies, autofill, rows, team, blind } = useRecos(stats, draft, pool);
  const persoCells = useMemo(() => new Map(rows.map(({ res }) => [res.champ, persoCell(perso, res.champ, draft.role)])), [rows, perso, draft.role]);
  const showPerso = [...persoCells.values()].some((c) => c.value !== "—");

  const selected = rows.find((r) => r.res.champ === openChamp)?.res ?? null;
  // ton champion présélectionné : sa ligne s'ouvre, avec l'explication (pas de carte en double au-dessus)
  const myInList = draft.myChamp != null && rows.some((r) => r.res.champ === draft.myChamp);
  useEffect(() => { if (draft.myChamp != null) setOpenChamp(draft.myChamp); }, [draft.myChamp]);
  const taken = new Set([...allies, ...enemies, ...draft.bans]);

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

      <DraftBand stats={stats} draft={draft} live={live} onPick={live ? undefined : setPicking} />

      <div className="stack">
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
            <h2>{draft.myLocked ? t("Ton pick est verrouillé")
              : autofill ? (blind ? t("Blind picks recommandés en autofill {v}", { v: ROLE_LABELS[draft.role] }) : t("Picks recommandés en autofill {v}", { v: ROLE_LABELS[draft.role] }))
              : blind ? t("Blind picks recommandés pour toi") : t("Picks recommandés pour toi")}</h2>
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
          {!draft.myLocked && rows.length > 0 && (
            <div className="recos__list reco-list stagger" key={draft.role}>
              <div className="reco-head" aria-hidden="true">
                <span className="reco-head__champ">{t("Champion")}</span>
                <span className="reco-head__wr">{t("Dans cette draft")}</span>
                {showPerso && <span className="reco-head__perso">{t("Toi")}</span>}
                <span className="reco-head__act" />
              </div>
              {rows.map(({ res, kind }, i) => (
                <div key={res.champ}>
                  {kind === "discovery" && !autofill && rows[i - 1]?.kind !== "discovery" && <Divider />}
                  <RecoRow stats={stats} res={res} rank={String(i + 1)} best={i === 0}
                           discovery={kind === "discovery" && !autofill} inPool={kind === "pool"} showPerso={showPerso}
                           open={openChamp === res.champ}
                           onToggle={() => setOpenChamp(openChamp === res.champ ? null : res.champ)}
                           onPreselect={() => preselect(res.champ)} perso={persoCells.get(res.champ)}
                           role={draft.role} mine={res.champ === draft.myChamp}
                           why={res.champ === draft.myChamp ? explain(stats, res, draft.role, allies, stats.params, blind) : undefined}
                           fill={fills(stats, res.champ, team)} enemies={enemies} />
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

interface RecoRowProps {
  stats: Stats; res: Result; rank: string; discovery: boolean; open: boolean;
  onToggle: () => void; onPreselect: () => void; compact?: boolean; perso?: PersoCell; role: number;
  /** Ton champion présélectionné : badge et explication dans la ligne. */
  mine?: boolean; why?: string;
  /** Manques de ton équipe que ce champion comble. */
  fill?: Gap[];
  /** Adversaires déjà choisis : objets et runes adaptés à leur équipe dans le détail. */
  enemies?: number[];
  /** Premier de la liste : badge « Meilleur choix ». */
  best?: boolean;
  /** Dans ton pool (badge gris). Faux en autofill, où tout est hors pool. */
  inPool?: boolean;
  /** Colonne « Toi » visible (masquée quand aucun champion de la liste n'a de stats perso). */
  showPerso?: boolean;
}

/** Une ligne de la liste des picks : clic = détail, survol = bouton « Présélectionner » (grande fenêtre). */
export function RecoRow({ stats, res, role, rank, discovery, open, onToggle, onPreselect, compact = false, perso, mine = false, why, fill = [], best = false, inPool = false, showPerso = true }: RecoRowProps) {
  const laner = res.details[0];
  const hasPerso = perso != null && perso.value !== "—";
  const key = (e: React.KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); }
  };
  return (
    <div className={`reco${open ? " is-open" : ""}${mine ? " is-mine" : ""}`}>
      <div className="reco__line" role="button" tabIndex={0} onClick={onToggle} onKeyDown={key} aria-expanded={open}>
        <span className="reco__rank">{rank}</span>
        <ChampionIcon stats={stats} champ={res.champ} size={compact ? 2.125 : 2.5} />
        <span className="reco__info">
          <span className="reco__title">
            <span className="reco__name">{champName(stats, res.champ)}</span>
            {best && !compact && <span className="badge badge--best">{t("Meilleur choix")}</span>}
            {mine && <span className="badge badge--picked">{t("Présélectionné")}</span>}
          </span>
          <span className="reco__meta">
            {/* compact : la section et le séparateur disent déjà pool / découverte, une seule ligne sous le nom */}
            {!compact && (discovery ? <span className="badge badge--discovery">{t("Découverte")}</span>
              : inPool ? <span className="badge badge--muted">{t("Dans ton pool")}</span> : null)}
            {!compact && fill.length > 0 && (
              <span className="badge badge--muted" title={t("Ce champion comble ce qui manque à ton équipe")}>{t("Comble : ")}{fill.map((g) => GAP_LABEL[g]).join(" · ")}</span>
            )}
            {!compact && <GainBadge res={res} />}
            {res.games < LOW_DATA_GAMES && <span className="badge badge--muted">{t("Peu de données")}</span>}
            {compact && (perso?.short
              ? <span className={`tone-${perso.tone}`}>{perso.short} <Trend tone={perso.tone} /></span>
              : <span className="reco__games">{t("{v} parties Master+", { v: int(res.games) })}</span>)}
          </span>
        </span>
        <span className={`reco__wr tone-${wrTone(res.score)}`}>{pct(res.score)}<Trend tone={wrTone(res.score)} /></span>
        {!compact && showPerso && (
          <span className={`reco__perso tone-${perso?.tone ?? "neutral"}`} title={perso?.label}>{perso?.value ?? "—"}</span>
        )}
        {!compact && (
          <span className="reco__act">
            {mine
              ? <span className="reco__inclient">{t("✓ Dans le client")}</span>
              : <button className="btn btn--secondary btn--small reco__pre" onClick={(e) => { e.stopPropagation(); onPreselect(); }}>{t("Présélectionner")}</button>}
          </span>
        )}
        <span className="reco__chev" aria-hidden="true"><Chevron open={open} /></span>
      </div>
      {open && (
        <div className="reco__detail">
          {why && <p className="mypick__why">{why}</p>}
          <div className="reco__factors">
            {compact && hasPerso && <FactorTile label={t("Toi sur {c}", { c: champName(stats, res.champ) })} text={perso!.value} tone={perso!.tone} />}
            {laner && laner.p >= 0.15
              ? <FactorTile label={t("Face à {champName} · {round} % d’être ton vis-à-vis", { champName: champName(stats, laner.enemy), round: Math.round(laner.p * 100) })} value={res.lane} />
              : <FactorTile label={t("Vis-à-vis pas encore choisi")} />}
            <FactorTile label={t("Contre le reste de l’équipe")} value={res.counters} />
            <FactorTile label={t("Avec tes alliés")} value={res.synergies} />
          </div>
          {laner && laner.p >= 0.5 && <MatchupNote stats={stats} champ={res.champ} role={role} enemy={laner.enemy} compact={compact} />}
          {compact && (mine
            ? <p className="reco__inclient reco__inclient--block">{t("✓ Présélectionné dans le client")}</p>
            : <button className="btn btn--primary" onClick={onPreselect}>{t("Présélectionner dans le client")}</button>)}
        </div>
      )}
    </div>
  );
}

/** Ce que cette draft change pour le champion, en points (affiché à partir de 0,3 point). */
function GainBadge({ res }: { res: Result }) {
  const g = draftGain(res);
  if (Math.abs(g) < 0.003) return null;
  const v = `${g > 0 ? "+" : "−"}${dec1(Math.abs(g) * 100)}`;
  return (
    <span className={`badge badge--gain ${g > 0 ? "is-up" : "is-down"}`}
          title={t("Effet de cette draft : vis-à-vis, reste de leur équipe, tes alliés et la composition")}>
      {t("{v} pt dans cette draft", { v })}
    </span>
  );
}

/** Séparateur entre ton pool et les découvertes. */
export function Divider({ compact = false }: { compact?: boolean }) {
  return (
    <p className="reco-divider">
      <strong>{t("Envie de tester ?")}</strong>
      <span>{compact ? t("Hors de ton pool") : t("Hors de ton pool, mais forts dans cette draft")}</span>
    </p>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" style={{ transform: open ? "rotate(180deg)" : undefined }}>
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Tuile d'un facteur du score : valeur en points et petite barre (pleine vers ±6 pts). */
function FactorTile({ label, value, text, tone }: { label: string; value?: number; text?: string; tone?: string }) {
  const tn = tone ?? (value == null ? "neutral" : value > 0.0005 ? "good" : value < -0.0005 ? "bad" : "neutral");
  const width = value == null ? 0 : Math.min(100, (Math.abs(value) / 0.06) * 100);
  return (
    <div className="factor-tile">
      <span className="factor-tile__label">{label}</span>
      <strong className={`tone-${tn}`}>{text ?? (value == null ? "—" : pts(value))}</strong>
      {text == null && <span className="factor-tile__bar"><span className={`tone-bg-${tn}`} style={{ width: `${width}%` }} /></span>}
    </div>
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

/** Recommandations de la draft : ton pool d’abord, complété par des découvertes jusqu’à 6 picks (ou le top du rôle en autofill). */
export function useRecos(stats: Stats, draft: Draft, pool: number[]) {
  return useMemo(() => {
    const allies = draft.allies.filter((c, i): c is number => c != null && i !== draft.role);
    const enemies = draft.enemies.filter((c): c is number => c != null);
    const r = recommend(stats, draft.role, pool, allies, enemies, draft.bans);
    const autofill = r.pool.length === 0;
    // composition de ton équipe sans toi : un pick qui comble un manque gagne au plus une place
    const team = analyzeTeam(stats, allies);
    // composition validée par le calibrage : déjà comptée dans le score ; sinon, l'ancien petit bonus d'une place
    const calibrated = (stats.params.comp ?? []).some(Boolean);
    const bump = (list: Result[]) => calibrated ? list
      : bumpForComposition(stats, list.map((res) => ({ champ: res.champ, res })), team).map((x) => x.res);
    const rows: RecoItem[] = autofill
      ? bump(topForRole(stats, draft.role, allies, enemies, draft.bans, 6)).map((res) => ({ res, kind: "discovery" as const }))
      : [...bump(r.pool).map((res) => ({ res, kind: "pool" as const })),
         ...bump(r.discoveries).map((res) => ({ res, kind: "discovery" as const }))];
    return { allies, enemies, autofill, rows, team, blind: r.blind };
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
  if (g > 0) return { value: pct(w / g), label: t("Toi · {games}", { games: games(g) }), tone: persoTone(g, w), short: t("Toi {pct} · {g}", { pct: pct(w / g), g: games(g) }) };
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
      <p className="mypick__why">{explain(stats, res, draft.role, allies, stats.params, !draft.myLocked && isBlind(stats, draft.role, enemies))}</p>
      {laner && laner.p >= 0.5 && <MatchupNote stats={stats} champ={champ} role={draft.role} enemy={laner.enemy} compact={compact} />}
      {/* runes, sorts et import seulement une fois le pick verrouillé : avant, ils changeraient encore */}
      {draft.myLocked && <RunePage stats={stats} champ={champ} role={draft.role} laner={laner && laner.p >= 0.5 ? laner.enemy : null} />}
    </div>
  );
}

/** Phase de bans : 3 champions à bannir. */
export function BanPanel({ stats, draft, compact = false, titled = true, onSelect }:
  { stats: Stats; draft: Draft; compact?: boolean; titled?: boolean; onSelect?: (champ: number) => void }) {
  const taken = draft.enemies.filter((c): c is number => c != null).concat(draft.bans, draft.allyBans ?? [], draft.enemyBans ?? []);
  const list = banSuggestions(stats, draft.role, draft.myChamp ?? null, draft.allies, taken);
  if (!list.length) return null;
  const anyPick = draft.myChamp != null || draft.allies.some((c, r) => c != null && r !== draft.role);
  const intro = anyPick ? t("D’après ta présélection, celles de ton équipe et les champions les plus joués")
    : t("Pas encore de présélection : les champions les plus menaçants et les plus joués ce patch");
  const why = (b: BanSuggestion) => b.vs == null
    ? t("{pct} de winrate en {role}", { pct: pct(b.winrate), role: ROLE_LABELS[b.role] })
    : b.mine ? t("Tu gagnes {pct} contre lui", { pct: pct(b.winrate) })
    : t("{name} gagne {pct} contre lui", { name: champName(stats, b.vs), pct: pct(b.winrate) });
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
                {why(b)} · {t("{n} parties", { n: int(b.games) })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
