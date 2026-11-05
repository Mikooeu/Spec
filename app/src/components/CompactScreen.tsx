import { useEffect, useState } from "react";
import { ROLE_LABELS, ROLE_SHORT, type Stats, enemyDisplay } from "../lib/score";
import { champName } from "../lib/ui";
import { ChampionIcon } from "./ChampionIcon";
import { Logo } from "./Logo";
import { BanPanel, MyPick, RecoRow, makeBanSelect, makePreselect, persoCell, useRecos, type Draft } from "./DraftScreen";
import { explain } from "../lib/score";
import type { PersonalState } from "../lib/api";
import { Segmented } from "./Segmented";
import { t } from "../lib/i18n";

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
}

/** Petite fenêtre à garder à côté du client LoL pendant la sélection des champions. */
export function CompactScreen(props: Props) {
  const { draft, live, onTop, onToggleTop, onExpand } = props;
  return (
    <div className="compact">
      <header className="compact__bar">
        <Logo className="brand__mark brand__mark--small" />
        <span className="compact__title">
          {draft ? t("Tu joues {v}", { v: ROLE_LABELS[draft.role] }) : t("Spec")}
        </span>
        {draft && <span className={`compact__state${live ? " is-live" : ""}`}>{live ? t("En direct") : t("Démo")}</span>}
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
      {draft ? <CompactDraft {...props} draft={draft} /> : <CompactWaiting {...props} />}
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

function CompactDraft({ stats, draft, pool, live, onRole, onEndDemo, onPreselect, onBan, perso, onDemoPick }: Props & { draft: Draft }) {
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { allies, autofill, rows } = useRecos(stats, draft, pool);
  const myInList = draft.myChamp != null && rows.some((r) => r.res.champ === draft.myChamp);
  useEffect(() => { if (draft.myChamp != null) setOpen(draft.myChamp); }, [draft.myChamp]);
  const preselect = makePreselect(stats, onPreselect, setNotice,
    live ? undefined : (champ) => onDemoPick?.(champ));

  return (
    <div className="compact__body">
      <Segmented className="segmented segmented--full" role="tablist" aria-label={t("Rôle assigné")}>
        {ROLE_SHORT.map((label, i) => (
          <button key={label} role="tab" aria-selected={draft.role === i} title={ROLE_LABELS[i]}
                  className={draft.role === i ? "is-active" : ""}
                  onClick={() => { onRole(i); setOpen(null); }}>{label}</button>
        ))}
      </Segmented>

      <div className="mini-teams">
        <MiniTeam stats={stats} label={t("Alliés")} champs={draft.allies} me={draft.role} locked={draft.allyLocked}
                  mine={draft.myChamp ?? null} />
        <MiniTeam stats={stats} label={t("Adversaires")} champs={enemyDisplay(stats, draft.enemies).map((r) => draft.enemies[r.index])} />
      </div>

      {draft.banPhase && <BanPanel stats={stats} draft={draft} compact onSelect={makeBanSelect(stats, live ? onBan : undefined, setNotice)} />}
      {draft.myChamp != null && (draft.myLocked || !myInList) && <MyPick stats={stats} draft={draft} compact />}

      {draft.myLocked ? (
        <p className="hint">{t("Champion verrouillé : importe tes runes et tes sorts ci-dessus.")}</p>
      ) : (
      <div className="compact__recos">
        <p className="compact__section">{autofill ? t("Autofill en {v}", { v: ROLE_LABELS[draft.role] }) : t("Recommandés pour toi")}</p>
        {rows.map(({ res, kind }, i) => (
          <div key={res.champ}>
            {kind === "discovery" && !autofill && rows[i - 1]?.kind !== "discovery" && <p className="divider-label">{t("Envie de tester ?")}</p>}
            <RecoRow stats={stats} res={res} rank={kind === "pool" ? String(i + 1) : "—"} compact
                     discovery={kind === "discovery"} open={open === res.champ}
                     onToggle={() => setOpen(open === res.champ ? null : res.champ)}
                     onPreselect={() => preselect(res.champ)} perso={persoCell(perso, res.champ, draft.role)}
                     role={draft.role} mine={res.champ === draft.myChamp}
                     why={res.champ === draft.myChamp ? explain(stats, res, draft.role, allies) : undefined} />
          </div>
        ))}
        {rows.length === 0 && <p className="hint">{t("Pas encore assez de parties pour ce rôle.")}</p>}
      </div>
      )}

      {!live && <button className="btn btn--secondary btn--small" onClick={onEndDemo}>{t("Terminer la démo")}</button>}
      {notice && <div className="toast toast--compact" role="status">{notice}</div>}
    </div>
  );
}

function MiniTeam({ stats, label, champs, me, locked, mine = null }: {
  stats: Stats; label: string; champs: (number | null)[]; me?: number; locked?: boolean[]; mine?: number | null;
}) {
  return (
    <div className="mini-team">
      <span className="mini-team__label">{label}</span>
      <div className="mini-team__icons">
        {champs.map((c, i) => {
          const isMe = i === me;
          const hover = locked != null && c != null && !locked[i];
          const title = isMe ? (mine != null ? t("Toi · {champName}", { champName: champName(stats, mine) }) : t("Toi")) : c == null ? t("Pas encore choisi") : `${champName(stats, c)}${hover ? t(" (survol)") : ""}`;
          return (
            <span key={i} className={`mini-slot${isMe ? " is-me" : ""}${hover ? " is-hover" : ""}`} title={title}>
              <ChampionIcon stats={stats} champ={isMe ? mine : c} size={1.875} tone={isMe ? "accent" : "default"} />
            </span>
          );
        })}
      </div>
    </div>
  );
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
