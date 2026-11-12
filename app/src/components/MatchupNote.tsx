// Note de matchup : affichée en draft (détail du pick, ton pick) et en partie (menu de build).
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { NOTE_MAX, getNote, useMatchupNotes, withNote } from "../lib/notes";
import type { Stats } from "../lib/score";
import { champName } from "../lib/ui";

/** Carte bleue avec la note, ou lien « Ajouter une note » quand il n'y en a pas encore. */
export function MatchupNote({ stats, champ, role, enemy, compact = false }: { stats: Stats; champ: number; role: number; enemy: number; compact?: boolean }) {
  const [notes, setNotes] = useMatchupNotes();
  const [editing, setEditing] = useState(false);
  const note = getNote(notes, champ, role, enemy);
  const enemyName = champName(stats, enemy);
  const save = (text: string) => { setNotes(withNote(notes, champ, role, enemy, text)); setEditing(false); };
  return (
    <>
      {note ? (
        <div className={`mnote${compact ? " mnote--compact" : ""}`} onClick={(e) => e.stopPropagation()}>
          <div className="mnote__head">
            <span className="mnote__label">{t("Ta note face à {e}", { e: enemyName })}</span>
            <button className="link-btn" onClick={() => setEditing(true)}>{t("Modifier")}</button>
          </div>
          <p className="mnote__text">{note}</p>
        </div>
      ) : (
        <button className="link-btn mnote__add" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
          {t("Ajouter une note face à {e}", { e: enemyName })}
        </button>
      )}
      {editing && (
        <NoteDialog title={t("{a} contre {b}", { a: champName(stats, champ), b: enemyName })}
                    hint={t("Affichée dès que {e} est ton vis-à-vis, en draft et en partie.", { e: enemyName })}
                    initial={note} onSave={(text) => save(text)} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

/** Fenêtre d'écriture d'une note ; avec `choices`, l'adversaire se choisit dans la fenêtre. */
export function NoteDialog({ title, hint, initial, onSave, onClose, choices, enemy, onEnemy }:
  { title: string; hint: string; initial: string; onSave: (text: string) => void; onClose: () => void;
    choices?: { id: number; name: string }[]; enemy?: number | null; onEnemy?: (id: number) => void }) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!choices) area.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, choices]);
  useEffect(() => { setText(initial); }, [initial]);
  const canSave = !choices || enemy != null;
  return (
    <div className="grecap-modal" role="dialog" aria-modal="true" aria-labelledby="mnote-title" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <form className="card mnote-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (canSave) onSave(text); }}>
        <h2 id="mnote-title">{title}</h2>
        {choices && (
          <label className="mnote-dialog__pick">
            <span>{t("Contre")}</span>
            <select value={enemy ?? ""} onChange={(e) => onEnemy?.(Number(e.target.value))} autoFocus>
              <option value="" disabled>{t("Choisis un adversaire")}</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <textarea ref={area} className="mnote-dialog__area" value={text} maxLength={NOTE_MAX} rows={4}
                  aria-label={t("Ta note")} disabled={!canSave} onChange={(e) => setText(e.target.value)} />
        <div className="mnote-dialog__meta">
          <span>{hint}</span>
          <span>{text.length} / {NOTE_MAX}</span>
        </div>
        <div className="mnote-dialog__actions">
          {initial && <button type="button" className="link-btn tone-bad" onClick={() => onSave("")}>{t("Supprimer la note")}</button>}
          <span className="grow" />
          <button type="button" className="btn btn--secondary btn--small" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn btn--primary btn--small" disabled={!canSave}>{t("Enregistrer")}</button>
        </div>
      </form>
    </div>
  );
}
