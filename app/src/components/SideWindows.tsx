// Fenêtres d'appoint ouvertes en plus de la fenêtre principale (qui reste où le joueur l'a laissée) :
//  - « compact » : le mode compact, collé au côté du client LoL pendant la draft ;
//  - « bubble » : la bulle posée dans le coin du client, qui s'ouvre au survol et quand c'est à toi ;
//  - « build » : le menu de build seul, affiché par-dessus le jeu avec le raccourci.
// Elles reçoivent l'état de la draft de la fenêtre principale (lib/bridge) et lui renvoient les actions du joueur.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadStats } from "../lib/api";
import { loadItems, localizeChampions, useInfo } from "../lib/ddragon";
import { banSuggestions, ROLE_LABELS, type Stats } from "../lib/score";
import { champName, pct, usePersistent, wrTone } from "../lib/ui";
import { sendAction, useSharedState, type SharedState } from "../lib/bridge";
import { FullscreenNotice } from "./FullscreenNotice";
import { importRunes, importSpells, IN_APP } from "../lib/lcu";
import { importItemSet } from "../lib/itemset";
import { dockToClient, resetDock, setOnTop } from "../lib/window";
import { shortcutLabel, useSpecShortcut } from "../lib/settings";
import { useLiveGame } from "../lib/live";
import { t } from "../lib/i18n";
import { CompactScreen } from "./CompactScreen";
import { AutoImportContext, ItemSetImportContext, RunePage, RuneImportContext, SpellImportContext } from "./Runes";
import { persoCell, useRecos, type Draft } from "./DraftScreen";
import { ChampionIcon } from "./ChampionIcon";
import { Logo } from "./Logo";
import { InGameView } from "./InGameScreen";
import { TopBarSlot } from "./TopBar";

/** Stats Master+ (cache du navigateur : même adresse que la fenêtre principale). */
function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { loadStats().then(localizeChampions).then(setStats).catch(() => undefined); }, []);
  return stats;
}

async function currentWindow() {
  return (await import("@tauri-apps/api/window")).getCurrentWindow();
}

/** Les fenêtres transparentes (bulle, build) ne doivent pas peindre le fond de l'appli. */
function useTransparentPage() {
  useEffect(() => {
    document.documentElement.classList.add("is-overlay");
    return () => document.documentElement.classList.remove("is-overlay");
  }, []);
}

/** Importeurs de runes, sorts et set d'objets, comme dans la fenêtre principale. */
function Importers({ stats, shared, children }: { stats: Stats; shared: SharedState; children: ReactNode }) {
  const itemInfo = useInfo(loadItems, stats.ddragon);
  const enemies = (shared.draft?.enemies ?? []).filter((e): e is number => e != null);
  const itemSet = shared.live ? (champ: number, role: number) => importItemSet(stats, champ, role, enemies, itemInfo) : null;
  return (
    <RuneImportContext.Provider value={shared.live ? importRunes : null}>
      <AutoImportContext.Provider value={shared.autoImport}>
        <SpellImportContext.Provider value={shared.live ? importSpells : null}>
          <ItemSetImportContext.Provider value={itemSet}>{children}</ItemSetImportContext.Provider>
        </SpellImportContext.Provider>
      </AutoImportContext.Provider>
    </RuneImportContext.Provider>
  );
}

const preselect = (champ: number) => sendAction({ kind: "preselect", champ });
const ban = (champ: number) => sendAction({ kind: "ban", champ });
const expand = () => { sendAction({ kind: "expand" }); };
const borderless = () => { sendAction({ kind: "borderless" }); };

// ---------------------------------------------------------------------------------------------
// Mode compact collé au client

export function CompactWindow() {
  const stats = useStats();
  const shared = useSharedState();
  const [onTop, setOnTopPref] = usePersistent<boolean>("spec.compact.onTop", true);
  const [dock] = usePersistent<boolean>("spec.compact.dock", true);
  useEffect(() => { setOnTop(onTop); }, [onTop]);

  // collée au client tant que le joueur ne la déplace pas ; affichée une fois placée
  useEffect(() => {
    if (!IN_APP) return;
    let stopped = false;
    resetDock();
    const tick = async () => {
      if (stopped || !dock) return;
      if ((await dockToClient()) === "moved") stopped = true;
    };
    (async () => { await tick(); (await currentWindow()).show(); })();
    const id = window.setInterval(tick, 800);
    return () => { stopped = true; window.clearInterval(id); resetDock(); };
  }, [dock]);

  if (!stats || !shared) return <div className="compact"><div className="compact__body compact__waiting"><div className="spinner" /></div></div>;
  return (
    <Importers stats={stats} shared={shared}>
      {shared.fullscreen && <div className="compact__fsn"><FullscreenNotice state={shared.fullscreen} onSwitch={borderless} compact /></div>}
      <CompactScreen stats={stats} draft={shared.draft} pool={shared.pool} live={shared.live}
                     onTop={onTop} clientOn={shared.clientOn} clientText={shared.clientText}
                     onRole={(role) => { sendAction({ kind: "role", role }); }}
                     onToggleTop={() => setOnTopPref(!onTop)} onExpand={expand}
                     onEndDemo={() => undefined}
                     onPreselect={shared.live ? preselect : undefined} onBan={shared.live ? ban : undefined}
                     perso={shared.perso} onPool={(role) => { sendAction({ kind: "pool", role }); }} />
    </Importers>
  );
}

// ---------------------------------------------------------------------------------------------
// Bulle posée sur le client

/** Largeur maximale de la fenêtre de la bulle (logique) : la bulle et sa carte, plus la marge de l'ombre. */
const BUBBLE_W = 380;

/** Place la fenêtre de la bulle dans la colonne de droite du client, sous l'équipe adverse et au-dessus du nom de la file
 *  (zone vide de la sélection des champions, pour ne cacher ni la grille, ni le chat, ni les boutons du bas).
 *  Sans client trouvé : coin bas droit de l'écran. */
async function placeBubble(height: number) {
  const mod = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const w = mod.getCurrentWindow();
  const scale = await w.scaleFactor();
  const rect = await invoke<[number, number, number, number] | null>("client_window").catch(() => null);
  const H = Math.round(height * scale);
  let W = Math.round(BUBBLE_W * scale), x: number, y: number;
  if (rect) {
    const [cx, cy, cw, ch] = rect;
    W = Math.max(Math.round(300 * scale), Math.min(W, Math.round(cw * 0.26)));   // la colonne de droite fait ~27 % du client
    x = cx + cw - W - Math.round(cw * 0.012);
    y = cy + Math.round(ch * 0.915) - H;                                          // juste au-dessus de « 5V5 · Classée »
  } else {
    const margin = Math.round(10 * scale);
    x = Math.round(window.screen.availWidth * scale) - W - margin;
    y = Math.round(window.screen.availHeight * scale) - H - margin;
  }
  await w.setSize(new mod.PhysicalSize(W, H));
  await w.setPosition(new mod.PhysicalPosition(x, y));
}

export function BubbleWindow() {
  useTransparentPage();
  const stats = useStats();
  const shared = useSharedState();
  const [hover, setHover] = useState(false);
  const leave = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const draft = shared?.draft ?? null;
  const open = hover || (!!draft?.myTurn && !draft.myLocked);

  // la fenêtre prend la taille de la bulle (repliée ou ouverte) et reste calée dans le coin du client
  useEffect(() => {
    if (!IN_APP || !box.current) return;
    let shown = false;
    const fit = async () => {
      const h = Math.ceil((box.current?.getBoundingClientRect().height ?? 60) + 16);
      await placeBubble(h).catch(() => undefined);
      if (!shown) { shown = true; (await currentWindow()).show(); }
    };
    const ro = new ResizeObserver(() => { fit(); });
    ro.observe(box.current);
    const id = window.setInterval(fit, 1000);   // suit le client s'il bouge
    fit();
    return () => { ro.disconnect(); window.clearInterval(id); };
  }, [stats != null && shared != null]);

  const onEnter = () => { window.clearTimeout(leave.current); setHover(true); };
  const onLeave = () => { leave.current = window.setTimeout(() => setHover(false), 350); };

  return (
    <div className="bubble-host" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="bubble-stack" ref={box}>
        {stats && shared && draft
          ? <Importers stats={stats} shared={shared}><Bubble stats={stats} shared={shared} draft={draft} open={open} /></Importers>
          : <div className="bubble-pill"><Logo className="bubble-pill__logo" /><span className="bubble-pill__text"><strong>Spec</strong><small>{t("En attente de la draft")}</small></span></div>}
      </div>
    </div>
  );
}

type Row = { champ: number; score: number; sub: string };

/** Durée de l'animation de fermeture de la carte (doit suivre .bubble-card.is-leaving dans styles.css). */
const CARD_OUT_MS = 180;

/** Garde la carte affichée le temps de son animation de sortie : [affichée, en train de se fermer]. */
function usePresence(open: boolean, outMs: number): [boolean, boolean] {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return; }
    const id = window.setTimeout(() => setShown(false), outMs);
    return () => window.clearTimeout(id);
  }, [open, outMs]);
  return [shown || open, shown && !open];
}

function Bubble({ stats, shared, draft, open }: { stats: Stats; shared: SharedState; draft: Draft; open: boolean }) {
  const { autofill, rows } = useRecos(stats, draft, shared.pool);
  const [shown, leaving] = usePresence(open, CARD_OUT_MS);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice((x) => (x === m ? null : m)), 3500); };

  const toRow = (champ: number, score: number): Row => {
    const cell = persoCell(shared.perso, champ, draft.role);
    return { champ, score, sub: cell.short ?? cell.label };
  };
  const pages: Row[][] = useMemo(() => {
    const pool = rows.filter((r) => r.kind === "pool").slice(0, 3).map((r) => toRow(r.res.champ, r.res.score));
    const disc = rows.filter((r) => r.kind === "discovery").slice(0, 3).map((r) => toRow(r.res.champ, r.res.score));
    return autofill || !pool.length ? [disc] : disc.length ? [pool, disc] : [pool];
  }, [rows, autofill, shared.perso]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cur = Math.min(page, pages.length - 1);
  const best = pages[0]?.[0] ?? null;
  const sel = picked ?? pages[cur]?.[0]?.champ ?? best?.champ ?? null;
  const selRow = pages.flat().find((r) => r.champ === sel) ?? best;

  const doPick = async (champ: number) => {
    if (!shared.live) return;
    const err = await preselect(champ);
    flash(err ?? t("{champName} présélectionné dans le client. À toi de le verrouiller.", { champName: champName(stats, champ) }));
  };

  // ---- phase de bans : la bulle passe en rouge
  if (draft.banPhase) {
    const enemies = draft.enemies.filter((c): c is number => c != null);
    const list = banSuggestions(stats, draft.role, draft.myChamp ?? null, draft.allies, enemies,
                                [...draft.bans, ...(draft.allyBans ?? []), ...(draft.enemyBans ?? [])], 4);
    const top = list.find((b) => b.champ === picked) ?? list[0];
    const why = (w: number, mine: boolean) => (mine ? t("Tu gagnes {pct} contre lui", { pct: pct(w) }) : t("{pct} de winrate en {role}", { pct: pct(w), role: ROLE_LABELS[draft.role] }));
    const doBan = async (champ: number) => {
      if (!shared.live) return;
      const err = await ban(champ);
      flash(err ?? t("{champName} survolé pour ton ban. À toi de valider dans le client.", { champName: champName(stats, champ) }));
    };
    return (
      <>
        {shown && list.length > 0 && (
          <div className={`bubble-card${leaving ? " is-leaving" : ""}`}>
            <BubbleHead stats={stats} draft={draft} tag={t("Bans")} tone="bad" />
            <p className="bubble-card__hint">{draft.myChamp != null ? t("Bans conseillés · d’après {c}, ton pick annoncé", { c: champName(stats, draft.myChamp) }) : t("Bans conseillés en {role}", { role: ROLE_LABELS[draft.role] })}</p>
            <div className="bubble-rows">
              {list.map((b) => (
                <button key={b.champ} className={`bubble-row${b.champ === top?.champ ? " is-ban" : ""}`} onClick={() => setPicked(b.champ)}>
                  <ChampionIcon stats={stats} champ={b.champ} size={2.25} round />
                  <span className="bubble-row__text"><strong>{champName(stats, b.champ)}</strong><small>{t("{pct} de pick", { pct: pct(b.games / Math.max(1, stats.matchesWeighted)) })}</small></span>
                  <span className="bubble-row__val tone-bad">{pct(b.winrate)}</span>
                </button>
              ))}
            </div>
            {top && <button className="btn btn--primary bubble-card__cta" onClick={() => doBan(top.champ)}>{t("Présélectionner {c} dans le client", { c: champName(stats, top.champ) })}</button>}
            <FullscreenNotice state={shared.fullscreen ?? null} onSwitch={borderless} compact />
            <button className="link bubble-card__more" onClick={expand}>{t("Agrandir ↗")}</button>
          </div>
        )}
        {top && (
          <Pill alert={shared.fullscreen === "full" || shared.fullscreen === "error"} stats={stats} champ={top.champ} tone="bad" title={t("Bannir {c}", { c: champName(stats, top.champ) })}
                sub={why(top.winrate, top.mine)} subTone="bad" action={t("Présélectionner")} onAction={() => doBan(top.champ)} />
        )}
        {notice && <div className="bubble-toast" role="status">{notice}</div>}
      </>
    );
  }

  // ---- champion verrouillé : runes et sorts
  if (draft.myLocked && draft.myChamp != null) {
    const auto = shared.autoImport?.champ === draft.myChamp ? shared.autoImport : null;
    return (
      <>
        {shown && (
          <div className={`bubble-card${leaving ? " is-leaving" : ""}`}>
            <BubbleHead stats={stats} draft={draft} tag={t("Verrouillé")} tone="good" />
            <RunePage stats={stats} champ={draft.myChamp} role={draft.role} laner={null} />
            <FullscreenNotice state={shared.fullscreen ?? null} onSwitch={borderless} compact />
            <button className="link bubble-card__more" onClick={expand}>{t("Agrandir ↗")}</button>
          </div>
        )}
        <Pill alert={shared.fullscreen === "full" || shared.fullscreen === "error"} stats={stats} champ={draft.myChamp} tone={auto?.ok ? "good" : "accent"}
              title={t("{c} verrouillé", { c: champName(stats, draft.myChamp) })}
              sub={auto?.ok ? t("✓ Runes et sorts importés") : t("Passe la souris pour importer tes runes")} subTone={auto?.ok ? "good" : "neutral"} />
      </>
    );
  }

  // ---- annonce des picks, attente et ton tour
  const glow = !!draft.myTurn;
  // la pastille montre ton champion présélectionné dans le client, sinon celui choisi dans la liste, sinon le meilleur
  const hovered = draft.myChamp != null ? pages.flat().find((r) => r.champ === draft.myChamp) ?? { champ: draft.myChamp, score: NaN, sub: "" } : null;
  const pill = hovered ?? selRow ?? best;
  const isBest = !!pill && pill.champ === best?.champ;
  const title = !pill ? t("Spec") : draft.planning ? t("Annonce {c}", { c: champName(stats, pill.champ) })
    : glow ? t("À toi : {c}", { c: champName(stats, pill.champ) }) : champName(stats, pill.champ);
  const wr = pill && Number.isFinite(pill.score) ? pct(pill.score) : "—";
  const sub = !pill ? t("Pas encore assez de parties pour ce rôle.")
    : hovered ? t("{pct} · présélectionné", { pct: wr })
    : draft.planning && isBest ? t("{pct} · ton meilleur pick", { pct: wr })
    : !glow && (draft.picksBefore ?? 0) > 0 ? t("{pct} · ton tour dans {n} picks", { pct: wr, n: draft.picksBefore ?? 0 })
    : t("{pct} · winrate estimé", { pct: wr });
  return (
    <>
      {shown && selRow && (
        <div className={`bubble-card${glow ? " is-glow" : ""}${leaving ? " is-leaving" : ""}`}>
          <BubbleHead stats={stats} draft={draft} tag={glow ? t("À toi") : draft.planning ? t("Annonce") : t("Sélection")} tone="accent" />
          {draft.planning && <p className="bubble-card__hint">{t("Ton pick à annoncer · adversaires encore inconnus")}</p>}
          <div className="bubble-pager">
            <div className="bubble-pager__view">
              <div className="bubble-pager__track" style={{ transform: `translateX(${-cur * 100}%)` }}>
                {pages.map((list, i) => (
                  <div key={i} className="bubble-rows bubble-pager__page" aria-hidden={i !== cur}>
                    {list.map((r) => (
                      <button key={r.champ} className={`bubble-row${r.champ === sel ? " is-selected" : ""}`} tabIndex={i === cur ? 0 : -1}
                              onClick={() => setPicked(r.champ)}>
                        <ChampionIcon stats={stats} champ={r.champ} size={2.25} round />
                        <span className="bubble-row__text"><strong>{champName(stats, r.champ)}</strong><small>{r.sub}</small></span>
                        <span className={`bubble-row__val tone-${wrTone(r.score)}`}>{pct(r.score)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {pages.length > 1 && (
              <button className="bubble-pager__arrow" onClick={() => setPage(cur === 0 ? 1 : 0)}
                      aria-label={cur === 0 ? t("Voir les picks hors de ton pool") : t("Revenir à ton pool")}>
                <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden><path d={cur === 0 ? "M1.5 1 6.5 6l-5 5" : "M6.5 1l-5 5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
          {pages.length > 1 && (
            <div className="bubble-pager__foot">
              <span>{cur === 0 ? t("Dans ton pool") : t("À découvrir · hors de ton pool")}</span>
              <span className="bubble-dots" aria-hidden>{pages.map((_, i) => <i key={i} className={i === cur ? "is-on" : ""} />)}</span>
            </div>
          )}
          {sel != null && draft.myChamp === sel
            ? <p className="bubble-card__ok">{t("✓ Présélectionné dans le client")}</p>
            : sel != null && <button className="btn btn--primary bubble-card__cta" onClick={() => doPick(sel)}>{t("Présélectionner {c} dans le client", { c: champName(stats, sel) })}</button>}
          {glow && <p className="bubble-card__hint bubble-card__hint--center">{t("Ensuite, verrouille dans le client")}</p>}
          <FullscreenNotice state={shared.fullscreen ?? null} onSwitch={borderless} compact />
          <button className="link bubble-card__more" onClick={expand}>{t("Agrandir ↗")}</button>
        </div>
      )}
      {pill && (
        <Pill alert={shared.fullscreen === "full" || shared.fullscreen === "error"} stats={stats} champ={pill.champ} tone="accent" glow={glow} title={title} sub={sub} subTone={wrTone(pill.score)}
              action={draft.myChamp === pill.champ ? undefined : t("Présélectionner")} onAction={() => doPick(pill.champ)} />
      )}
      {notice && <div className="bubble-toast" role="status">{notice}</div>}
    </>
  );
}

function BubbleHead({ stats, draft, tag, tone }: { stats: Stats; draft: Draft; tag: string; tone: "accent" | "bad" | "good" }) {
  void stats;
  return (
    <div className="bubble-card__head">
      <Logo className="bubble-pill__logo" />
      <strong>{t("Tu joues {v}", { v: ROLE_LABELS[draft.role] })}</strong>
      <span className={`stag stag--${tone}`}><span className="stag__dot" aria-hidden />{tag}</span>
      <span className="grow" />
      <button className="link" onClick={expand}>{t("Agrandir ↗")}</button>
    </div>
  );
}

function Pill({ stats, champ, title, sub, subTone, tone, glow = false, action, onAction, alert = false }:
  { stats: Stats; champ: number; title: string; sub: string; subTone: string; tone: "accent" | "bad" | "good"; glow?: boolean; action?: string; onAction?: () => void; alert?: boolean }) {
  return (
    <div className={`bubble-pill bubble-pill--${tone}${glow ? " is-glow" : ""}`}>
      <Logo className="bubble-pill__logo" />
      <ChampionIcon stats={stats} champ={champ} size={2.25} round />
      <span className="bubble-pill__text"><strong>{title}</strong><small className={`tone-${subTone}`}>{sub}</small></span>
      {action && <button className="btn btn--primary bubble-pill__action" onClick={onAction}>{action}</button>}
      {alert && <span className="bubble-pill__alert" title={t("Ton jeu est en Plein écran")} aria-label={t("Ton jeu est en Plein écran")} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Menu de build seul, par-dessus le jeu

export function BuildWindow() {
  useTransparentPage();
  const stats = useStats();
  const shared = useSharedState();
  const game = useLiveGame(true, false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [shortcut] = useSpecShortcut();
  const [shown, setShown] = useState(0);   // relance le message « Rappuie sur… » à chaque affichage
  useEffect(() => {
    if (!IN_APP) return;
    let off: (() => void) | undefined;
    import("@tauri-apps/api/event").then(async ({ listen }) => { off = await listen("spec:build-shown", () => setShown((n) => n + 1)); });
    return () => off?.();
  }, []);
  const start = shared?.inGame ?? null;
  return (
    <div className="build-window">
      <header className="topbar build-window__bar" data-tauri-drag-region>
        <div className="topbar__slot" ref={setSlot} />
      </header>
      <TopBarSlot.Provider value={slot}>
        <div className="build-window__body">
          {stats && start ? <InGameView stats={stats} start={start} game={game} passive />
            : <div className="empty-state"><div className="spinner" /></div>}
        </div>
      </TopBarSlot.Provider>
      {shortcut && <div key={shown} className="build-window__hint" role="status">{t("Rappuie sur {k} pour le fermer", { k: shortcutLabel(shortcut) })}</div>}
    </div>
  );
}
