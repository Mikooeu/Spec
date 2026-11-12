// Note de matchup : affichée en draft (détail du pick, ton pick) et en partie (menu de build).
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { NOTE_MAX, noteKey, useMatchupNotes } from "../lib/notes";
import type { Stats } from "../lib/score";
import { champName } from "../lib/ui";

/** Carte bleue avec la note, ou lien « Ajouter une note » quand il n'y en a pas encore. */
export function MatchupNote({ stats, champ, enemy, compact = false }: { stats: Stats; champ: number; enemy: number; compact?: boolean }) {
  const [notes, setNotes] = useMatchupNotes();
  const [editing, setEditing] = useState(false);
  const key = noteKey(champ, enemy);
  const note = notes[key] ?? "";
  const enemyName = champName(stats, enemy);
  const save = (text: string) => {
    const next = { ...notes };
    if (text.trim()) next[key] = text.trim(); else delete next[key];
    setNotes(next);
    setEditing(false);
  };
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
        <NoteDialog title={t("{a} contre {b}", { a: champName(stats, champ), b: enemyName })} enemy={enemyName}
                    initial={note} onSave={save} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

function NoteDialog({ title, enemy, initial, onSave, onClose }:
  { title: string; enemy: string; initial: string; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="grecap-modal" role="dialog" aria-modal="true" aria-labelledby="mnote-title" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <form className="card mnote-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(text); }}>
        <h2 id="mnote-title">{title}</h2>
        <textarea ref={area} className="mnote-dialog__area" value={text} maxLength={NOTE_MAX} rows={4}
                  aria-label={t("Ta note")} placeholder={t("Ce qu’il faut retenir face à {e}", { e: enemy })}
                  onChange={(e) => setText(e.target.value)} />
        <div className="mnote-dialog__meta">
          <span>{t("Affichée dès que {e} est ton vis-à-vis, en draft et en partie.", { e: enemy })}</span>
          <span>{text.length} / {NOTE_MAX}</span>
        </div>
        <div className="mnote-dialog__actions">
          {initial && <button type="button" className="link-btn tone-bad" onClick={() => onSave("")}>{t("Supprimer la note")}</button>}
          <span className="grow" />
          <button type="button" className="btn btn--secondary btn--small" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn btn--primary btn--small">{t("Enregistrer")}</button>
        </div>
      </form>
    </div>
  );
}
