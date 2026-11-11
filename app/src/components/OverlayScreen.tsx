import { t } from "../lib/i18n";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { OVERLAY_STATS, closeOverlay, openOverlay, setOverlayInteractive, type Corner, type OverlaySettings, type OverlayStat } from "../lib/overlay";
import { Choice, Toggle } from "./SettingsScreen";
import { LABEL, SAMPLE, statValues } from "./OverlayViews";
import { Logo } from "./Logo";

const STAT: Record<OverlayStat, [() => string, () => string]> = {
  cs: [() => t("CS par minute"), () => t("Sbires et monstres")],
  gold: [() => t("Or par minute"), () => t("Estimé avec tes objets")],
  kp: [() => t("Participation aux kills"), () => t("Kills et assists")],
  vision: [() => t("Vision par minute"), () => t("Score de vision")],
  kda: [() => t("KDA"), () => t("(K + A) / morts")],
  goldDiff: [() => t("Écart d’or"), () => t("Face à ton vis-à-vis")],
};
const CORNERS: [Corner, () => string][] = [["tl", () => t("Haut gauche")], ["tr", () => t("Haut droite")], ["bl", () => t("Bas gauche")], ["br", () => t("Bas droite")]];

/** Onglet Overlay : réglages à gauche, aperçu à droite (l'overlay s'y déplace à la souris), stats en cases à cocher. */
export function OverlayScreen({ settings: s, onChange: save, inGame }: { settings: OverlaySettings; onChange: (s: OverlaySettings) => void; inGame: boolean }) {
  // placement sur l'écran réel : l'overlay s'affiche (valeurs d'exemple hors partie) et reçoit la souris
  const startEdit = async () => { save({ ...s, editing: true }); await openOverlay("overlay"); await setOverlayInteractive(true); };
  const stopEdit = async () => { save({ ...s, editing: false }); await setOverlayInteractive(false); if (!inGame) await closeOverlay("overlay"); };
  useEffect(() => () => { if (s.editing) { stopEdit(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const count = OVERLAY_STATS.filter((k) => s.stats[k]).length;
  return (
    <div className="content ovs">
      <header className="page-head">
        <div>
          <h1>{t("Overlay")}</h1>
        </div>
        <label className="ovs__master" title={t("Le jeu doit être en mode Sans bordure ou Fenêtré (Options › Vidéo › Mode fenêtre).")}><span>{t("Afficher l’overlay")}</span>
          <Toggle on={s.enabled} onChange={() => save({ ...s, enabled: !s.enabled })} label={t("Afficher l’overlay")} /></label>
      </header>

      <div className={`ovs__grid${s.enabled ? "" : " is-off"}`}>
        <section className="card ovs-card ovs-settings">
          <div className="ovs-row"><span className="ovs-row__label">{t("Disposition")}</span>
            <Choice value={s.layout} onChange={(layout) => save({ ...s, layout })} options={[["vertical", t("Verticale")], ["horizontal", t("Horizontale")]]} /></div>
          <div className="ovs-row ovs-row--top">
            <span className="ovs-row__text"><span className="ovs-row__label">{t("Position")}</span>
              <small>{s.pos ? t("Placé à la main. Choisis un coin pour revenir à une position fixe.") : t("Un coin, ou glisse l’overlay dans l’aperçu.")}</small></span>
            <div className="ovs-corners" role="radiogroup" aria-label={t("Position")}>
              {CORNERS.map(([c, label]) => (
                <button key={c} role="radio" aria-checked={!s.pos && s.corner === c} title={label()} aria-label={label()}
                        className={!s.pos && s.corner === c ? "is-active" : ""} onClick={() => save({ ...s, corner: c, pos: null })} />
              ))}
            </div>
          </div>
          <div className="ovs-row"><span className="ovs-row__label">{t("Opacité")}</span>
            <Choice value={String(s.opacity) as "60" | "80" | "100"} onChange={(o) => save({ ...s, opacity: Number(o) as 60 | 80 | 100 })}
                    options={[["60", "60 %"], ["80", "80 %"], ["100", "100 %"]]} /></div>
          <div className="ovs-row ovs-row--top">
            <span className="ovs-row__text"><span className="ovs-row__label">{t("Écran de chargement")}</span>
              <small>{t("Les cartes Spec par-dessus l’écran de chargement du jeu.")}</small></span>
            <Toggle on={s.loading} onChange={() => save({ ...s, loading: !s.loading })} label={t("Écran de chargement")} />
          </div>
        </section>

        <section className="card ovs-card ovs-preview">
          <div className="ovs-card__head"><h2>{t("Aperçu")}</h2>
            <button className={`btn ${s.editing ? "btn--primary" : "btn--secondary"} btn--small`} onClick={s.editing ? stopEdit : startEdit}>
              {s.editing ? t("Terminé") : t("Placer sur mon écran")}</button></div>
          <Preview settings={s} onMove={(pos) => save({ ...s, pos })} />
          <small className="muted">{s.editing
            ? t("Glisse l’overlay sur ton écran, puis clique sur Terminé ou appuie sur Échap. Le jeu ne reçoit pas les clics pendant ce temps.")
            : t("Glisse l’overlay dans l’aperçu : il sera au même endroit en jeu, quelle que soit ta résolution.")}</small>
        </section>
      </div>

      <section className="card ovs-card">
        <div className="ovs-card__head"><h2>{t("Stats affichées")}</h2><span className="muted small">{t("{n} sur 6", { n: count })}</span></div>
        <div className="ovs-stats">
          {OVERLAY_STATS.map((k) => (
            <button key={k} role="checkbox" aria-checked={s.stats[k]} className={`ovs-stat${s.stats[k] ? " is-on" : ""}`}
                    onClick={() => save({ ...s, stats: { ...s.stats, [k]: !s.stats[k] } })}>
              <span className="ovs-stat__box" aria-hidden="true">{s.stats[k] && "✓"}</span>
              <span className="ovs-stat__text"><strong>{STAT[k][0]()}</strong><small>{STAT[k][1]()}</small></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Écran de jeu factice (16:9) avec l'overlay à sa place réelle ; on peut l'y glisser. */
function Preview({ settings: s, onMove }: { settings: OverlaySettings; onMove: (pos: { x: number; y: number }) => void }) {
  const screen = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const shown = OVERLAY_STATS.filter((k) => s.stats[k]);
  const values = statValues(SAMPLE, null);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!box.current) return;
    const r = box.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    box.current.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !box.current || !screen.current) return;
    const sr = screen.current.getBoundingClientRect(), br = box.current.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - drag.current.dx - sr.left), sr.width - br.width) / sr.width;
    const y = Math.min(Math.max(0, e.clientY - drag.current.dy - sr.top), sr.height - br.height) / sr.height;
    setLive({ x, y });
  };
  const up = () => { if (drag.current && live) onMove(live); drag.current = null; setLive(null); };
  const pos = live ?? s.pos;
  const place = pos ? { left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, right: "auto", bottom: "auto" } : {};
  return (
    <div ref={screen} className="ovs-screen" aria-label={t("Aperçu de l’écran de jeu")}>
      <span className="ovs-screen__fps">FPS 144 · 18 ms</span>
      <span className="ovs-screen__hud" /><span className="ovs-screen__map" />
      {s.enabled && shown.length > 0 && (
        <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up}
             className={`ovp ovp--${s.layout} ovp--${s.corner}`} style={{ opacity: s.opacity / 100, ...place }}>
          {s.layout === "vertical" ? <p className="ovp__head"><Logo className="ovp__logo" />Spec</p> : <Logo className="ovp__logo" />}
          {shown.map((k) => (
            <span key={k} className="ovp__item"><span className="ovp__label">{LABEL[k]()}</span>
              <strong className={values[k].tone ? `tone-${values[k].tone}` : ""}>{values[k].text}</strong></span>
          ))}
        </div>
      )}
      {!s.enabled && <p className="ovs-screen__off">{t("Overlay désactivé")}</p>}
    </div>
  );
}
