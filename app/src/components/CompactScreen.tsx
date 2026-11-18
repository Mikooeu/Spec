import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ROLE_LABELS, ROLE_SHORT, type Stats, enemyDisplay } from "../lib/score";
import { champName, pct, pctN, pts, wrTone } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { Logo } from "./Logo";
import { BanPanel, MyPick, makeBanSelect, makePreselect, persoCell, useRecos, type Draft } from "./DraftScreen";
import { RunePage } from "./Runes";
import { Chip } from "./TopBar";
import { winProbability } from "../lib/winprob";
import { explain } from "../lib/score";
import type { PersonalState } from "../lib/api";
import { Segmented } from "./Segmented";
import { plural, t } from "../lib/i18n";

interface Props {
  stats: Stats;
  draft: Draft | null;           // null : en attente de la draft
  pool: number[];
  live: boolean;
  onTop: boolean;
  clientText: string;
  clientOn: boolean;
  onRole: (role: number) => void;
  onToggleTop: () => void;
  onExpand: () => void;
  onDemo?: () => void;
  onEndDemo: () => void;
  onPreselect?: (champ: number) => Promise<string | null>;
  onBan?: (champ: number) => Promise<string | null>;
  perso?: PersonalState;
  onDemoPick?: (champ: number) => void;
  /** Ouvre le champion pool (grande fenêtre) sur ce rôle. */
  onPool?: (role: number) => void;
  /** Page du champion joué, affichée pendant la partie à la place de la draft. */
  game?: ReactNode;
}

/** Petite fenêtre à garder à côté du client LoL pendant la sélection des champions. */
export function CompactScreen(props: Props) {
  const { draft, live, onTop, onToggleTop, onExpand } = props;
  return (
    <div className="compact">
      <header className="compact__bar">
        <Logo className="brand__mark brand__mark--small" />
        <span className="compact__title">
          {props.game ? t("En partie") : draft ? t("Tu joues {v}", { v: ROLE_LABELS[draft.role] }) : t("Spec")}
        </span>
        {draft && !props.game && <span className={`compact__state${live ? " is-live" : ""}`}>{live ? t("En direct") : t("Démo")}</span>}
        <span className="grow" />
        <button className={`icon-btn${onTop ? " is-active" : ""}`} onClick={onToggleTop}
                title={onTop ? t("Ne plus garder au premier plan") : t("Garder au premier plan")}
                aria-label={t("Garder au premier plan")} aria-pressed={onTop}>
          <PinIcon />
        </button>
        <button className="icon-btn" onClick={onExpand} title={t("Agrandir la fenêtre")} aria-label={t("Agrandir la fenêtre")}>
          <ExpandIcon />
        </button>
      </header>
      {props.game ? <div className="compact__body compact__game">{props.game}</div>
        : draft ? <CompactDraft {...props} draft={draft} /> : <CompactWaiting {...props} />}
      <p className="compact__legal">{t("Spec n’est pas approuvé par Riot Games.")}</p>
    </div>
  );
}

function CompactWaiting({ clientText, clientOn, onDemo }: Props) {
  return (
    <div className="compact__body compact__waiting">
      <div className="spinner" />
      <h2>{t("En attente de la draft")}</h2>
      <p className="muted small">{t("Tes recommandations s’affichent dès la sélection des champions.")}</p>
      <p className="compact__client"><span className={clientOn ? "dot" : "dot dot--off"} />{clientText}</p>
      {onDemo && <button className="btn btn--secondary" onClick={onDemo}>{t("Simuler une draft")}</button>}
    </div>
  );
}

function CompactDraft({ stats, draft, pool, live, onRole, onEndDemo, onPreselect, onBan, perso, onDemoPick, onPool }: Props & { draft: Draft }) {
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { allies, autofill, rows } = useRecos(stats, draft, pool);
  const myInList = draft.myChamp != null && rows.some((r) => r.res.champ === draft.myChamp);
  useEffect(() => { if (draft.myChamp != null) setOpen(draft.myChamp); }, [draft.myChamp]);
  const preselect = makePreselect(stats, onPreselect, setNotice,
    live ? undefined : (champ) => onDemoPick?.(champ));
  // un seul pick affiché en grand : celui cliqué en bas, sinon le premier de la liste
  const shownAt = Math.max(0, rows.findIndex((r) => r.res.champ === open));
  const shown = rows[shownAt] ?? null;
  const shownPerso = shown ? persoCell(perso, shown.res.champ, draft.role) : { value: "—", label: "", tone: "neutral" as const };
  const nPool = rows.filter((r) => r.kind === "pool").length, nNew = rows.length - nPool;
  const sign = (v: number) => (v > 0.0005 ? "good" : v < -0.0005 ? "bad" : "neutral");

  return (
    <div className="compact__body">
      <Segmented className="segmented segmented--full" role="tablist" aria-label={t("Rôle assigné")}>
        {ROLE_SHORT.map((label, i) => (
          <button key={label} role="tab" aria-selected={draft.role === i} title={ROLE_LABELS[i]}
                  className={draft.role === i ? "is-active" : ""}
                  onClick={() => { onRole(i); setOpen(null); }}>{label}</button>
        ))}
      </Segmented>

      <TeamsBar stats={stats} draft={draft} />

      {draft.banPhase && <BanPanel stats={stats} draft={draft} compact onSelect={makeBanSelect(stats, live ? onBan : undefined, setNotice)} />}
      {draft.myChamp != null && (draft.myLocked || !myInList) && <MyPick stats={stats} draft={draft} compact />}

      {draft.myLocked ? (
        <p className="hint">{t("Champion verrouillé : importe tes runes et tes sorts ci-dessus.")}</p>
      ) : (
      <div className="compact__recos">
        {autofill && rows.length > 0 && (
          <p className="compact__autofill">
            <span>{t("Aucun {v} dans ton pool : les meilleurs du rôle dans cette draft.", { v: ROLE_LABELS[draft.role] })}</span>
            {onPool && <button className="link" onClick={() => onPool(draft.role)}>{t("Ajouter")}</button>}
          </p>
        )}
        {shown && (
          <section className="focus" aria-label={champName(stats, shown.res.champ)}>
            <Chip tone="accent">{t("N°{k} sur {n}", { k: shownAt + 1, n: rows.length })}{autofill ? "" : ` · ${shown.kind === "pool" ? t("dans ton pool") : t("à découvrir")}`}</Chip>
            <ChampionIcon stats={stats} champ={shown.res.champ} size={4.75} />
            <h2 className="focus__name">{champName(stats, shown.res.champ)}</h2>
            <p className="focus__wr">
              <strong className={`tone-${wrTone(shown.res.score)}`}>{pct(shown.res.score)}</strong>
              <small>{t("winrate estimé dans cette draft")}</small>
            </p>
            <div className="focus__tiles">
              <FocusTile label={t("Toi sur {c}", { c: champName(stats, shown.res.champ) })} value={shownPerso.value === "—" ? "—" : shownPerso.short?.replace(/^\S+\s/, "").replace(/\s\D+$/, "") ?? shownPerso.value}
                         tone={shownPerso.tone} title={shownPerso.label} />
              <FocusTile label={t("Contre leur équipe")} value={pts(shown.res.lane + shown.res.counters)} tone={sign(shown.res.lane + shown.res.counters)} />
              <FocusTile label={t("Avec tes alliés")} value={pts(shown.res.synergies)} tone={sign(shown.res.synergies)} />
            </div>
            {shown.res.champ === draft.myChamp && <p className="focus__why">{explain(stats, shown.res, draft.role, allies)}</p>}
            <RunePage stats={stats} champ={shown.res.champ} role={draft.role} laner={shown.res.details[0]?.p >= 0.5 ? shown.res.details[0].enemy : null} />
            {shown.res.champ === draft.myChamp
              ? <p className="reco__inclient reco__inclient--block">{t("✓ Présélectionné dans le client")}</p>
              : <button className="btn btn--secondary focus__pre" onClick={() => preselect(shown.res.champ)}>{t("Présélectionner dans le client")}</button>}
          </section>
        )}
        {rows.length > 1 && (
          <div className="focus-others" role="tablist" aria-label={t("Tes meilleurs picks")}>
            {rows.map(({ res }) => (
              <button key={res.champ} role="tab" aria-selected={res.champ === shown?.res.champ} title={champName(stats, res.champ)}
                      className={`focus-other${res.champ === shown?.res.champ ? " is-active" : ""}`} onClick={() => setOpen(res.champ)}>
                <ChampionIcon stats={stats} champ={res.champ} size={2.25} />
                <span className={`tone-${wrTone(res.score)}`}>{pct(res.score)}</span>
              </button>
            ))}
          </div>
        )}
        {rows.length > 0 && !autofill && (
          <p className="focus-count">{[nPool ? plural(nPool, "{n} de ton pool", "{n} de ton pool") : "", nNew ? plural(nNew, "{n} à découvrir", "{n} à découvrir") : ""].filter(Boolean).join(" · ")}</p>
        )}
        {rows.length === 0 && <p className="hint">{t("Pas encore assez de parties pour ce rôle.")}</p>}
      </div>
      )}

      {!live && <button className="btn btn--secondary btn--small" onClick={onEndDemo}>{t("Terminer la démo")}</button>}
      {notice && <div className="toast toast--compact" role="status">{notice}</div>}
    </div>
  );
}

/** Les deux équipes sur une ligne, avec la victoire estimée entre les deux. */
function TeamsBar({ stats, draft }: { stats: Stats; draft: Draft }) {
  const allies = draft.allies.map((c, i) => (i === draft.role ? draft.myChamp ?? null : c));
  const picked = allies.flatMap((c, role) => (c != null ? [{ champ: c, role }] : []));
  const foes = enemyDisplay(stats, draft.enemies).map((r) => draft.enemies[r.index]);
  const known = foes.filter((c): c is number => c != null);
  const p = winProbability(stats, picked, known);
  const ok = p != null && picked.length + known.length > 0;
  const ally = p == null ? 50 : Math.round(p * 100);
  const slot = (c: number | null, i: number, me: boolean, hover: boolean) => (
    <span key={i} className={`teams-bar__slot${me ? " is-me" : ""}${hover ? " is-hover" : ""}`}
          title={c == null ? (me ? t("Toi") : t("Pas encore choisi")) : `${me ? t("Toi · {champName}", { champName: champName(stats, c) }) : champName(stats, c)}${hover ? t(" (survol)") : ""}`}>
      <ChampionIcon stats={stats} champ={c} size={1.125} tone={me ? "accent" : "default"} />
    </span>
  );
  return (
    <div className="teams-bar">
      <span className="teams-bar__team">{allies.map((c, i) => slot(c, i, i === draft.role, draft.allyLocked != null && c != null && !draft.allyLocked[i] && i !== draft.role))}</span>
      <span className="teams-bar__win" title={ok ? t("Victoire estimée") : t("Le calcul s’affiche dès que le serveur l’a validé sur les parties Master+.")}>
        <strong className={ok ? "is-ally" : ""}>{ok ? pctN(ally) : "—"}</strong>
        <span className="teams-bar__bar" aria-hidden><i style={{ flexGrow: ok ? ally : 50 }} /><i style={{ flexGrow: ok ? 100 - ally : 50 }} /></span>
        <strong className={ok ? "is-enemy" : ""}>{ok ? pctN(100 - ally) : "—"}</strong>
      </span>
      <span className="teams-bar__team">{foes.map((c, i) => slot(c, i, false, false))}</span>
    </div>
  );
}

function FocusTile({ label, value, tone, title }: { label: string; value: string; tone: string; title?: string }) {
  return <div className="focus__tile" title={title}><span>{label}</span><strong className={`tone-${tone}`}>{value}</strong></div>;
}

const PinIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
    <path d="M10.5 1.5 14.5 5.5 11.8 6.6 9.4 9 9.8 12.2 8.6 13.4 5.8 10.6 2.5 13.9 2.1 13.5 5.4 10.2 2.6 7.4 3.8 6.2 7 6.6 9.4 4.2Z"
          fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

const ExpandIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor"
          strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
