import { useEffect, useMemo, useState } from "react";
import {
  LOW_DATA_GAMES, ROLE_LABELS, ROLE_SHORT, banSuggestions, enemyRoles, explain, recommend, roleDistribution,
  scoreChampion, topForRole, type Result, type Stats,
} from "../lib/score";
import { RunePage } from "./Runes";
import { champName, int, patchLabel, pct, pts, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import type { PersonalState } from "../lib/api";
import { ChampionPicker } from "./ChampionPicker";
import { Segmented } from "./Segmented";

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

  const { allies, enemies, autofill, rows } = useRecos(stats, draft, pool);

  const selected = rows.find((r) => r.res.champ === openChamp)?.res ?? null;
  // ton champion présélectionné : sa ligne s'ouvre, avec l'explication (pas de carte en double au-dessus)
  const myInList = draft.myChamp != null && rows.some((r) => r.res.champ === draft.myChamp);
  useEffect(() => { if (draft.myChamp != null) setOpenChamp(draft.myChamp); }, [draft.myChamp]);
  const taken = new Set([...allies, ...enemies, ...draft.bans]);
  // rôle affiché pour chaque adversaire : un seul par rôle, comme dans une vraie équipe
  const enemyRole = useMemo(() => {
    const { best } = enemyRoles(stats, enemies);
    let j = 0;
    return draft.enemies.map((c) => (c == null ? null : best[j++] ?? null));
  }, [stats, draft.enemies]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <p className="overline">{live ? "Sélection des champions · en direct" : "Sélection des champions · mode démo"}</p>
          <h1>Tu joues {ROLE_LABELS[draft.role]}</h1>
        </div>
        <div className="head-actions">
          <Segmented className="segmented" role="tablist" aria-label="Rôle assigné">
            {ROLE_LABELS.map((label, i) => (
              <button key={label} role="tab" aria-selected={draft.role === i}
                      className={draft.role === i ? "is-active" : ""}
                      onClick={() => { onChange({ ...draft, role: i }); setOpenChamp(null); }}>{label}</button>
            ))}
          </Segmented>
          {!live && (
            <button className={`btn btn--secondary${draft.banPhase ? " is-on" : ""}`} aria-pressed={!!draft.banPhase}
                    onClick={() => onChange({ ...draft, banPhase: !draft.banPhase })}>Phase de bans</button>
          )}
          {!live && onEnd && <button className="btn btn--secondary" onClick={onEnd}>Terminer la démo</button>}
        </div>
      </header>

      <div className={wide ? "columns" : "stack"}>
        <section className={wide ? "teams teams--column" : "teams"} aria-label="Équipes">
          <TeamCard title="Ton équipe">
            {draft.allies.map((c, i) => {
              const me = i === draft.role;
              const mine = me ? draft.myChamp ?? null : null;
              return (
                <SlotRow key={i} stats={stats} label={ROLE_SHORT[i]} champ={me ? mine : c}
                         name={me ? (mine != null ? champName(stats, mine) : "À toi de choisir") : c == null ? "En attente" : champName(stats, c)}
                         detail={me ? (mine == null ? "Ton tour" : draft.myLocked ? "Lock · toi" : "Survole · toi")
                                 : c == null ? (live ? "Pas encore choisi" : "Clique pour ajouter un pick")
                                 : draft.allyLocked && !draft.allyLocked[i] ? "Survole" : "Lock"}
                         tone={me ? "me" : c == null ? "empty" : "default"}
                         onClick={me || live ? undefined : () => setPicking({ side: "ally", index: i })} />
              );
            })}
          </TeamCard>
          <TeamCard title="Équipe adverse">
            {draft.enemies.map((c, i) => {
              const role = enemyRole[i];
              return (
                <SlotRow key={i} stats={stats} label={role != null ? ROLE_SHORT[role] : "—"} champ={c}
                         name={c == null ? "En attente" : champName(stats, c)}
                         detail={c == null ? (live ? "Pas encore choisi" : "Clique pour ajouter un pick") : rolesText(stats, c)}
                         tone={c == null ? "empty" : "default"}
                         onClick={live ? undefined : () => setPicking({ side: "enemy", index: i })} />
              );
            })}
          </TeamCard>
        </section>

        <section className="recos" aria-label="Recommandations">
          {draft.banPhase && (
            <>
              <div className="section-head">
                <h2>Bans recommandés</h2>
                <span className="muted small">Phase de bans · {ROLE_LABELS[draft.role]}</span>
              </div>
              <BanPanel stats={stats} draft={draft} titled={false} onSelect={banSelect} />
            </>
          )}
          <div className={`section-head${draft.banPhase ? " section-head--spaced" : ""}`}>
            <h2>{draft.myLocked ? "Ton pick est verrouillé" : autofill ? `Picks recommandés en autofill ${ROLE_LABELS[draft.role]}` : "Picks recommandés pour toi"}</h2>
            <span className="muted small">
              {int(Number(stats.meta.matches ?? 0))} parties Master+ · patch {patchLabel(stats.meta.patch)}
            </span>
          </div>
          {draft.myChamp != null && (draft.myLocked || !myInList) && <MyPick stats={stats} draft={draft} />}
          {draft.myLocked && (
            <p className="hint">Plus de présélection à faire : importe tes runes et tes sorts ci-dessus.</p>
          )}
          {!draft.myLocked && autofill && (
            <p className="hint">Ton pool est vide pour ce rôle : voici les meilleurs choix de cette draft.</p>
          )}
          {!draft.myLocked && (
            <div className="recos__list stagger" key={draft.role}>
              {rows.map(({ res, kind }, i) => (
                <div key={res.champ}>
                  {kind === "discovery" && !autofill && rows[i - 1]?.kind !== "discovery" && <p className="divider-label">Envie de tester ?</p>}
                  <RecoRow stats={stats} res={res} rank={kind === "pool" ? String(i + 1) : "—"}
                           discovery={kind === "discovery"} open={openChamp === res.champ}
                           onToggle={() => setOpenChamp(openChamp === res.champ ? null : res.champ)}
                           onPreselect={() => preselect(res.champ)} perso={persoCell(perso, res.champ, draft.role)}
                           role={draft.role} mine={res.champ === draft.myChamp}
                           why={res.champ === draft.myChamp ? explain(stats, res, draft.role, allies) : undefined} />
                </div>
              ))}
            </div>
          )}
          {!draft.myLocked && rows.length === 0 && (
            <p className="hint">Pas encore assez de parties pour ce rôle. Laisse tourner le collecteur.</p>
          )}
          {wide && selected && !draft.myLocked && <MatchupPanel stats={stats} res={selected} perso={perso} role={draft.role} />}
        </section>
      </div>

      {picking && (
        <ChampionPicker stats={stats} taken={taken}
                        title={picking.side === "ally" ? `Pick allié · ${ROLE_LABELS[picking.index]}` : "Pick adverse"}
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
  if (!first) return "Rôle inconnu";
  const head = `Probabilité d’être ${ROLE_WORDS[first.role]} : ${Math.round(first.p * 100)} %`;
  return second && second.p >= 0.15 ? `${head} · ${ROLE_WORDS[second.role]} : ${Math.round(second.p * 100)} %` : head;
}

function TeamCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card team">
      <h3 className="card__title">{title}</h3>
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
}

export function RecoRow({ stats, res, rank, discovery, open, onToggle, onPreselect, compact = false, perso, role, mine = false, why }: RecoRowProps) {
  const laner = res.details[0];
  return (
    <div className={`reco${open ? " is-open" : ""}`}>
      <button className="reco__line" onClick={onToggle} aria-expanded={open}>
        <span className="reco__rank">{rank}</span>
        <ChampionIcon stats={stats} champ={res.champ} size={compact ? 2.125 : 2.5} />
        <span className="reco__info">
          <span className="reco__name">{champName(stats, res.champ)}</span>
          <span className="reco__meta">
            {mine && <span className="badge badge--mine">Présélectionné</span>}
            {discovery && <span className="badge">Découverte</span>}
            {!compact && <span>{discovery ? "Hors de ton pool" : "Dans ton pool"}</span>}
            {res.games < LOW_DATA_GAMES && <span className="warn">Peu de données</span>}
            {compact && perso?.short && <span className={`tone-${perso.tone}`}>{perso.short}</span>}
          </span>
        </span>
        <span className="reco__stat">
          <span className={`reco__wr tone-${wrTone(res.score)}`}>{pct(res.score)}</span>
          <span className="reco__label">Dans cette draft</span>
        </span>
        {!compact && <>
          <span className="reco__sep" />
          <span className="reco__perso">
            <span className={`reco__perso-value tone-${perso?.tone ?? "neutral"}`}>{perso?.value ?? "—"}</span>
            <span className="reco__label">{perso?.label ?? "Stats perso indisponibles"}</span>
          </span>
        </>}
      </button>
      {open && (
        <div className="reco__detail">
          {why && <p className="mypick__why">{why}</p>}
          <div className="reco__factors">
          {laner && laner.p >= 0.15 && (
            <Factor label={`Face à ${champName(stats, laner.enemy)} · ${Math.round(laner.p * 100)} % d’être ton vis-à-vis`}
                    value={res.lane} />
          )}
          <Factor label="Contre le reste de l’équipe" value={res.counters} />
          <Factor label="Avec tes alliés" value={res.synergies} />
          </div>
          <RunePage stats={stats} champ={res.champ} role={role} laner={laner && laner.p >= 0.5 ? laner.enemy : null} />
          {!mine && <button className="btn btn--primary" onClick={onPreselect}>Présélectionner dans le client</button>}
        </div>
      )}
    </div>
  );
}

function Factor({ label, value }: { label: string; value: number }) {
  return (
    <span className="factor">
      {label} <strong className={`tone-${value > 0.0005 ? "good" : value < -0.0005 ? "bad" : "neutral"}`}>{pts(value)}</strong>
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
          <h3>{champName(stats, res.champ)}{laner ? ` face à ${champName(stats, laner.enemy)}` : ""}</h3>
          <p className="muted small">
            {laner ? `Matchup de la ligne sélectionnée · ${Math.round(laner.p * 100)} % d’être ton vis-à-vis`
                   : "Aucun ennemi visible pour l’instant"}
          </p>
        </div>
      </div>
      <div className="tiles">
        <Tile label="Master+ sur ce matchup"
              value={laner && laner.games > 0 ? pct(laner.wins / laner.games) : "—"}
              detail={laner ? `${int(laner.games)} parties ce patch` : "En attente du vis-à-vis"} />
        <Tile label="Ton bilan face à ce champion" {...matchupTile(stats, perso, res.champ, role, laner?.enemy)} />
        <Tile label="Plus gros risque de la draft"
              value={risk && risk.counterDelta < -0.0005 ? champName(stats, risk.enemy) : "Aucun"}
              detail={risk && risk.counterDelta < -0.0005 ? pts(risk.counterDelta) : "Pas d’ennemi défavorable"}
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
    const rows: RecoItem[] = autofill
      ? topForRole(stats, draft.role, allies, enemies, draft.bans, 6).map((res) => ({ res, kind: "discovery" as const }))
      : [...r.pool.map((res) => ({ res, kind: "pool" as const })),
         ...r.discoveries.map((res) => ({ res, kind: "discovery" as const }))];
    return { allies, enemies, autofill, rows };
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
      flash(`Démo : ${champName(stats, champ)} est survolé comme dans le client.`);
      return;
    }
    const error = await onPreselect(champ);
    flash(error ?? `${champName(stats, champ)} présélectionné dans le client. À toi de le verrouiller.`);
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
      flash(`Démo : en partie, ${champName(stats, champ)} serait survolé pour ton ban.`);
      return;
    }
    const error = await onBan(champ);
    flash(error ?? `${champName(stats, champ)} survolé pour ton ban. À toi de valider dans le client.`);
  };
}

type Tone = "good" | "bad" | "neutral";
export interface PersoCell { value: string; label: string; tone: Tone; short?: string }

const games = (n: number) => `${int(n)} partie${n > 1 ? "s" : ""}`;
const persoTone = (g: number, w: number): Tone => (g >= 5 ? wrTone(w / g) : "neutral");

/** Colonne « toi » d'une recommandation : winrate de la saison dans ce rôle (ou toutes lanes). */
export function persoCell(perso: PersonalState | undefined, champ: number, role: number): PersoCell {
  if (!perso || perso.kind === "off") return { value: "—", label: "Stats perso indisponibles", tone: "neutral" };
  if (perso.kind === "no-account") return { value: "—", label: "Lance le client LoL", tone: "neutral" };
  if (perso.kind === "unregistered") return { value: "—", label: "À activer dans ton profil", tone: "neutral" };
  if (perso.kind === "loading") return { value: "—", label: "Chargement…", tone: "neutral" };
  if (perso.kind === "error") return { value: "—", label: "Serveur injoignable", tone: "neutral" };
  const d = perso.data;
  const [g, w] = d.byRole.get(`${champ}:${role}`) ?? [0, 0];
  if (g > 0) return { value: pct(w / g), label: `Toi · ${games(g)}`, tone: persoTone(g, w), short: `Toi ${pct(w / g)} · ${g}` };
  const [ga, wa] = d.byChamp.get(champ) ?? [0, 0];
  if (ga > 0) return { value: pct(wa / ga), label: `Toi, autres lanes · ${games(ga)}`, tone: persoTone(ga, wa) };
  if (d.syncing && d.matches === 0) return { value: "—", label: "Synchro en cours", tone: "neutral" };
  return { value: "—", label: "Jamais joué cette saison", tone: "neutral" };
}

function matchupTile(stats: Stats, perso: PersonalState | undefined, champ: number, role: number, enemy: number | undefined) {
  if (enemy == null) return { value: "—", detail: "En attente du vis-à-vis" };
  if (!perso || perso.kind !== "ready") {
    const why = perso?.kind === "unregistered" ? "Active tes stats perso dans ton profil"
      : perso?.kind === "no-account" ? "Lance le client LoL" : "Stats perso indisponibles";
    return { value: "—", detail: why };
  }
  const [g, w] = perso.data.matchups.get(`${champ}:${role}:${enemy}`) ?? [0, 0];
  if (g === 0) return { value: "—", detail: `Jamais affronté ${champName(stats, enemy)} avec ce champion cette saison` };
  return { value: `${w} V – ${g - w} D`, detail: `${pct(w / g)} sur ${games(g)} cette saison` };
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
          <p className="overline">{draft.myLocked ? "Ton pick" : "Ta présélection"}</p>
          <p className="mypick__name">{champName(stats, champ)}</p>
        </div>
        <span className="reco__stat">
          <span className={`reco__wr tone-${wrTone(res.score)}`}>{pct(res.score)}</span>
          <span className="reco__label">Dans cette draft</span>
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
  const intro = draft.myChamp == null ? `Pas de présélection : les meilleurs winrates en ${role}`
    : counters === list.length ? `Les matchups que ${me} perd le plus en ${role}`
    : counters > 0 ? `Les matchups que ${me} perd, puis les plus forts en ${role}`
    : `${me} n’a pas de matchup nettement perdant : les meilleurs winrates en ${role}`;
  return (
    <div className={`card bans${compact ? " bans--compact" : ""}`}>
      {titled && <p className="bans__title">Bans recommandés</p>}
      <p className="muted small">
        {intro}
      </p>
      <div className="bans__list">
        {list.map((b) => (
          <button key={b.champ} className="bans__item" onClick={() => onSelect?.(b.champ)} disabled={!onSelect}
                  title={`Survoler ${champName(stats, b.champ)} pour ton ban`}>
            <ChampionIcon stats={stats} champ={b.champ} size={compact ? 1.75 : 2} />
            <span className="bans__text">
              <span className="bans__name">{champName(stats, b.champ)}</span>
              <span className="muted small">
                {b.against ? `Tu gagnes ${pct(b.winrate)} contre lui` : `${pct(b.winrate)} de winrate en ${role}`} · {int(b.games)} parties
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
