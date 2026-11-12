// Objectifs de la semaine : liste dans « Ta semaine », fenêtre de choix, et bloc du récap.
import { useEffect, useState } from "react";
import { GOAL_DEFS, GOAL_ORDER, MAX_GOALS, goalProgress, goalReached, goalTargetLabel, goalValue, useGoals, weekRanked,
  type Goal, type GoalKind } from "../lib/goals";
import { loadHistory, type Game } from "../lib/history";
import { t } from "../lib/i18n";
import type { Stats } from "../lib/score";
import { champName } from "../lib/ui";

const goalLabel = (stats: Stats, g: Goal) =>
  g.kind === "champWr" && g.champ != null ? t("Winrate sur {c}", { c: champName(stats, g.champ) }) : GOAL_DEFS[g.kind].label();

function GoalBar({ label, value, tone, progress }: { label: string; value: string; tone: "run" | "good" | "bad"; progress: number }) {
  return (
    <li className="goal">
      <div className="goal__top"><span>{label}</span><strong className={`goal__value goal__value--${tone}`}>{value}</strong></div>
      <span className="goal__track"><span className={`goal__fill goal__fill--${tone}`} style={{ width: `${Math.round(progress * 100)}%` }} /></span>
    </li>
  );
}

/** Objectifs dans la carte « Ta semaine » de l'accueil. */
export function WeekGoals({ stats, games, defaultChamp }: { stats: Stats; games: Game[]; defaultChamp: number | null }) {
  const [goals, setGoals] = useGoals();
  const [open, setOpen] = useState(false);
  const week = weekRanked(games);
  return (
    <div className="week-goals">
      <div className="week-goals__head">
        <h3>{t("Objectifs")}</h3>
        <button className="link-btn" onClick={() => setOpen(true)}>{goals.length ? t("Modifier") : t("Choisir")}</button>
      </div>
      {goals.length === 0 ? (
        <p className="muted small">{t("Choisis jusqu’à 3 objectifs pour ta semaine.")}</p>
      ) : (
        <ul className="goal-list">
          {goals.map((g) => {
            const v = goalValue(g, week);
            const ok = goalReached(g, v);
            return <GoalBar key={g.kind} label={`${goalLabel(stats, g)} · ${goalTargetLabel(g)}`}
                            value={v == null ? "—" : `${GOAL_DEFS[g.kind].format(v)}${ok ? " ✓" : ""}`}
                            tone={ok ? "good" : "run"} progress={goalProgress(g, v)} />;
          })}
        </ul>
      )}
      {goals.length > 0 && <p className="week-goals__foot">{t("Remis à zéro lundi · parties classées de la semaine : {n}", { n: week.length })}</p>}
      {open && <GoalsDialog stats={stats} goals={goals} defaultChamp={defaultChamp}
                            onSave={(g) => { setGoals(g); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

function GoalsDialog({ stats, goals, defaultChamp, onSave, onClose }:
  { stats: Stats; goals: Goal[]; defaultChamp: number | null; onSave: (g: Goal[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Goal[]>(goals);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const kinds = GOAL_ORDER.filter((k) => k !== "champWr" || defaultChamp != null || draft.some((g) => g.kind === "champWr"));
  const find = (k: GoalKind) => draft.find((g) => g.kind === k);
  const toggle = (k: GoalKind) => {
    if (find(k)) setDraft(draft.filter((g) => g.kind !== k));
    else if (draft.length < MAX_GOALS) setDraft([...draft, { kind: k, target: GOAL_DEFS[k].initial, ...(k === "champWr" ? { champ: defaultChamp ?? undefined } : {}) }]);
  };
  const bump = (k: GoalKind, dir: 1 | -1) => {
    const def = GOAL_DEFS[k];
    setDraft(draft.map((g) => g.kind !== k ? g : { ...g, target: Math.min(def.max, Math.max(def.min, Math.round((g.target + dir * def.step) * 10) / 10)) }));
  };
  return (
    <div className="grecap-modal" role="dialog" aria-modal="true" aria-labelledby="goals-title" onClick={onClose}>
      <div className="card goals-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="goals-dialog__head">
          <h2 id="goals-title">{t("Tes objectifs de la semaine")}</h2>
          <span className="goals-dialog__count">{draft.length} / {MAX_GOALS}</span>
        </div>
        <ul className="goals-dialog__list">
          {kinds.map((k) => {
            const g = find(k);
            const def = GOAL_DEFS[k];
            const label = k === "champWr" ? t("Winrate sur {c}", { c: champName(stats, g?.champ ?? defaultChamp ?? null) }) : def.label();
            const full = !g && draft.length >= MAX_GOALS;
            return (
              <li key={k} className={`goals-opt${g ? " goals-opt--on" : ""}${full ? " goals-opt--full" : ""}`}>
                <label className="goals-opt__check">
                  <input type="checkbox" checked={!!g} disabled={full} onChange={() => toggle(k)} />
                  <span>{label}</span>
                </label>
                <span className={`goals-opt__target${g ? "" : " goals-opt__target--off"}`}>
                  <button type="button" disabled={!g} onClick={() => bump(k, -1)} aria-label={t("Baisser la cible")}>−</button>
                  <strong>{def.atLeast ? def.format(g?.target ?? def.initial) : t("{v} max", { v: def.format(g?.target ?? def.initial) })}</strong>
                  <button type="button" disabled={!g} onClick={() => bump(k, 1)} aria-label={t("Monter la cible")}>+</button>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="goals-dialog__actions">
          <span className="muted small">{t("Remis à zéro chaque lundi · parties classées seulement")}</span>
          <span className="grow" />
          <button className="btn btn--secondary btn--small" onClick={onClose}>{t("Annuler")}</button>
          <button className="btn btn--primary btn--small" onClick={() => onSave(draft)}>{t("Enregistrer")}</button>
        </div>
      </div>
    </div>
  );
}

/** Récap : l'effet de cette partie sur chaque objectif (seulement pour une partie classée de la semaine). */
export function RecapGoals({ stats, game }: { stats: Stats; game: Game }) {
  const [goals] = useGoals();
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadHistory(50).then((g) => alive && setGames(g)).catch(() => alive && setGames([]));
    return () => { alive = false; };
  }, [game.id]);
  if (!goals.length || !games) return null;
  const after = weekRanked(games, game.created);
  if (!after.some((g) => g.id === game.id)) return null;
  const before = after.filter((g) => g.id !== game.id);
  const rows = goals.map((g) => {
    const v0 = goalValue(g, before), v1 = goalValue(g, after);
    const def = GOAL_DEFS[g.kind];
    const worse = v0 == null || v1 == null ? null : def.atLeast ? v1 < v0 : v1 > v0;
    const ok = goalReached(g, v1);
    const fmt = (v: number | null) => (v == null ? "—" : def.format(v));
    return { g, value: `${fmt(v0)} → ${fmt(v1)}${ok ? " ✓" : ""}`, tone: ok ? "good" as const : worse ? "bad" as const : "run" as const, progress: goalProgress(g, v1) };
  });
  const onTrack = rows.filter((r) => r.tone !== "bad").length;
  return (
    <section className="card grecap-card recap-goals">
      <div className="grecap-head">
        <h2>{t("Tes objectifs après cette partie")}</h2><span className="grow" />
        <span className={onTrack === rows.length ? "small tone-good" : "small muted"}>{t("{n} sur {m} en bonne voie", { n: onTrack, m: rows.length })}</span>
      </div>
      <ul className="goal-list">
        {rows.map((r) => <GoalBar key={r.g.kind} label={`${goalLabel(stats, r.g)} · ${goalTargetLabel(r.g)}`} value={r.value} tone={r.tone} progress={r.progress} />)}
      </ul>
    </section>
  );
}
