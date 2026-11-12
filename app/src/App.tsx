import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import { DraftScreen, type Draft } from "./components/DraftScreen";
import { ProfileScreen } from "./components/ProfileScreen";
import { PoolScreen, type Pools } from "./components/PoolScreen";
import { TierListScreen } from "./components/TierListScreen";
import { ChampionScreen } from "./components/ChampionScreen";
import { loadHistory, useLpTracking, type Game } from "./lib/history";
import { recommend, topForRole, type Result, type Stats } from "./lib/score";
import { analyzeTeam, bumpForComposition } from "./lib/composition";
import { recordPick } from "./lib/impact";
import { loadStats, register, usePersonal, useRegionStats, type Region } from "./lib/api";
import { int, normalize, patchLabel, usePersistent, useUiScale } from "./lib/ui";
import { importRunes, importSpells, preselect, preselectBan, sessionToDraft, useLolClient, type Account, type ClientState } from "./lib/lcu";
import { RuneImportContext, SpellImportContext } from "./components/Runes";
import { REGION_LABEL, RegionSelect } from "./components/RegionSelect";
import { applyCompact, requestAttention, setOnTop, watchCompactExpand } from "./lib/window";
import { CompactScreen } from "./components/CompactScreen";
import { InGameView, type GameStart } from "./components/InGameScreen";
import { RecapView } from "./components/RecapView";
import { HomeScreen } from "./components/HomeScreen";
import { useLiveGame } from "./lib/live";
import { OverlayScreen } from "./components/OverlayScreen";
import { LoadingCards } from "./components/LoadingCards";
import { closeOverlay, openOverlay, useOverlaySettings } from "./lib/overlay";
import { loadLoading, saveLoading, type LoadingData } from "./lib/loading";
import { useUpdate, type UpdateState } from "./lib/updater";
import { Logo } from "./components/Logo";
import { localizeChampions } from "./lib/ddragon";
import { SettingsScreen } from "./components/SettingsScreen";
import { Onboarding } from "./components/Onboarding";
import { Tour, specTour } from "./components/Tour";
import { PrivacyDialog } from "./components/PrivacyDialog";
import { useDefaultRegion, useOnboarded, useRoles, useSelectAlert } from "./lib/settings";
import { t } from "./lib/i18n";

type Screen = "draft" | "profile" | "tier" | "pool" | "champion" | "overlay" | "settings";
interface ChampView { champ: number; role: number }
const SCREENS: [Screen, string][] = [["draft", t("Draft")], ["profile", t("Profil")], ["tier", t("Tier list")], ["pool", t("Champion pool")], ["overlay", t("Overlay")], ["settings", t("Réglages")]];

/** Icône de chaque onglet de la barre latérale (traits de 1,5 px, comme le reste de l'appli). */
const NAV_PATHS: Record<Screen, string> = {
  draft: "M3 3h4v10H3zM9 3h4v10H9z",
  profile: "M8 2.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5zM2.75 13.75c.75-2.4 2.8-3.75 5.25-3.75s4.5 1.35 5.25 3.75",
  tier: "M3 4h10M3 8h7M3 12h4",
  champion: "M3 4h10M3 8h7M3 12h4",
  pool: "M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z",
  overlay: "M2 3h12v9H2zM9 5h3v3H9z",
  settings: "M14 2.67H9.33M6.67 2.67H2M14 8H8M5.33 8H2M14 13.33H10.67M8 13.33H2M9.33 1.33v2.67M5.33 6.67v2.67M10.67 12v2.67",
};
function NavIcon({ screen }: { screen: Screen }) {
  return (
    <svg className="nav__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path d={NAV_PATHS[screen]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Draft fictive de démonstration (remplacée plus tard par la lecture du client LoL). */
function demoDraft(stats: Stats): Draft {
  const id = (name: string) =>
    [...stats.champions.values()].find((c) => normalize(c.name) === normalize(name))?.id ?? null;
  return {
    role: 2,
    allies: [id(t("Darius")), id(t("Vi")), null, id(t("Jinx")), null],
    enemies: [id(t("Sylas")), id(t("Lee Sin")), id(t("Syndra")), null, id(t("Nautilus"))],
    bans: [],
  };
}

export default function App() {
  const wide = useUiScale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // après un changement de langue, l'appli se redessine : on rouvre l'écran où l'on était (les réglages)
  const [screen, setScreen] = useState<Screen>(() => {
    const back = sessionStorage.getItem("spec.reopen") as Screen | null;
    sessionStorage.removeItem("spec.reopen");
    return back ?? "draft";
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pools, setPools] = usePersistent<Pools>("spec.pools", [[], [], [], [], []]);
  const client = useLolClient();
  const [roleOverride, setRoleOverride] = useState<number | null>(null);

  const session = client.status === "champselect" ? client.session : null;
  useEffect(() => { if (!session) setRoleOverride(null); }, [session == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = session ? sessionToDraft(session, roleOverride) : null;
  const [roles, setRoles] = useRoles();
  const [tierRole, setTierRole] = useState(roles.main ?? 0);
  // région des stats de la tier list et des pages champion : celle des réglages à chaque lancement (la draft reste en EUW)
  const [defaultRegion] = useDefaultRegion();
  const [region, setRegion] = useState<Region>(defaultRegion);
  useEffect(() => { setRegion(defaultRegion); }, [defaultRegion]);
  const regionStats = useRegionStats(stats, region);
  const regionSelect = <RegionSelect value={region} onChange={setRegion} />;
  const [champView, setChampView] = useState<ChampView | null>(null);
  const lpVersion = useLpTracking(client);
  const openChamp = (champ: number, role: number) => { setChampView({ champ, role }); setScreen("champion"); };
  // depuis le mode compact (autofill) : grande fenêtre, champion pool ouvert sur le rôle de la draft
  const [poolRole, setPoolRole] = useState<number | null>(null);
  const onPool = (r: number) => { setPoolRole(r); setCompact(false); setScreen("pool"); };

  // pick verrouillé pendant la draft : le menu de build s'ouvre dans l'onglet Draft au lancement de la partie
  // (noté à chaque rendu : un effet séparé se ferait écraser par la remise à zéro du début de draft)
  const lastPick = useRef<GameStart | null>(null);
  const [inGame, setInGame] = useState<GameStart | null>(null);
  const phase = client.status === "idle" ? client.phase : client.status;
  useEffect(() => {
    if (live?.myLocked && live.myChamp != null) {
      lastPick.current = { champ: live.myChamp, role: live.role, enemies: live.enemies.filter((c): c is number => c != null) };
    }
  });
  // récap de la partie qui vient de se terminer (affiché dans l'onglet Draft jusqu'à la prochaine draft)
  const [recap, setRecap] = useState<Game | null>(null);
  const played = useRef<number | null>(null);
  const recapToken = useRef(0);   // début de la partie en cours (ms), pour retrouver la bonne partie ensuite
  useEffect(() => { if (inGame && played.current == null) played.current = Date.now(); }, [inGame]);
  useEffect(() => {
    if (!["PreEndOfGame", "EndOfGame", "WaitingForStats"].includes(phase) || played.current == null) return;
    const since = played.current - 15 * 60_000;
    played.current = null;
    const token = ++recapToken.current;   // une nouvelle draft annule la recherche
    let tries = 0;
    // la partie met quelques secondes à arriver dans l'historique du client
    const look = async () => {
      const g = (await loadHistory(1).catch(() => [] as Game[]))[0];
      if (token !== recapToken.current) return;
      if (g && g.created >= since) { if (!g.remake) { setRecap(g); setScreen("draft"); } return; }
      if (tries++ < 12) window.setTimeout(look, 5000);
    };
    window.setTimeout(look, 3000);
  }, [phase]);
  useEffect(() => {
    if (phase === "champselect") { setInGame(null); setRecap(null); recapToken.current++; setScreen("draft"); lastPick.current = null; return; }
    if (phase === "InProgress" || phase === "GameStart") {
      // Spec ouvert en pleine partie : champion et rôle viennent de la partie elle-même
      const start = lastPick.current;
      setInGame((g) => g ?? start ?? { champ: null, role: null, enemies: [] });
      if (start) setScreen("draft");
      lastPick.current = null;
      return;
    }
    // partie terminée : retour sur l'écran d'attente de la draft
    if (["PreEndOfGame", "EndOfGame", "WaitingForStats", t("Lobby"), t("None"), "offline"].includes(phase)) setInGame(null);
  }, [phase]);
  const liveGame = useLiveGame(inGame != null, true);
  const [overlay, setOverlay] = useOverlaySettings();
  // un déplacement resté ouvert (Spec fermé en plein déplacement) ne doit pas rouvrir l'overlay au démarrage
  useEffect(() => { if (overlay.editing) setOverlay({ ...overlay, editing: false }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // écran de chargement : les 10 joueurs, lus une fois la draft terminée (la partie n'a pas encore commencé)
  const [loading, setLoading] = useState<LoadingData | null>(null);
  // l'API du jeu peut répondre dès l'écran de chargement : la partie n'a vraiment commencé qu'avec le chrono qui tourne
  const started = liveGame != null && liveGame.time > 1;
  // une fois la partie commencée, l'écran de chargement ne revient plus (fin de partie : le jeu se ferme avant le client)
  const [hadStart, setHadStart] = useState(false);
  useEffect(() => { if (started) setHadStart(true); else if (!inGame) setHadStart(false); }, [started, inGame]);
  const loadingPhase = inGame != null && !started && !hadStart;
  useEffect(() => {
    if (!inGame) { setLoading(null); saveLoading(null); return; }
    if (!stats || loading) return;
    let alive = true, tries = 0;
    const read = async () => {
      const first = (d: LoadingData) => { if (alive) { setLoading(d); saveLoading(d); } };
      const d = await loadLoading(stats, account?.puuid ?? savedAccount?.puuid ?? null, undefined, first).catch(() => null);
      if (!alive) return;
      if (d) { setLoading(d); saveLoading(d); } else if (tries++ < 10) setTimeout(read, 3000);
    };
    read();
    return () => { alive = false; };
  }, [inGame != null, stats != null]); // eslint-disable-line react-hooks/exhaustive-deps
  // fenêtres par-dessus le jeu : l'écran de chargement, puis les stats dès que la partie a commencé
  useEffect(() => {
    if (loadingPhase && loading && overlay.loading) openOverlay("loading"); else closeOverlay("loading");
    if ((inGame && started && overlay.enabled) || overlay.editing) openOverlay("overlay"); else closeOverlay("overlay");
  }, [loadingPhase, loading != null, started, inGame != null, overlay.loading, overlay.enabled, overlay.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stats) localStorage.setItem("spec.ddragon", stats.ddragon); }, [stats]);
  // « Spec t'aide-t-il à gagner ? » : au lock, on note la place du champion dans les recos de Spec
  useEffect(() => {
    if (!stats || !live?.myLocked || live.myChamp == null) return;
    const allies = live.allies.filter((c, i): c is number => c != null && i !== live.role);
    const enemies = live.enemies.filter((c): c is number => c != null);
    const r = recommend(stats, live.role, pools[live.role], allies, enemies, live.bans);
    // même ordre que l'écran de draft (bonus de composition compris)
    const team = analyzeTeam(stats, allies);
    const bump = (l: Result[]) => bumpForComposition(stats, l, team);
    const list = r.pool.length ? [...bump(r.pool), ...bump(r.discoveries)] : bump(topForRole(stats, live.role, allies, enemies, live.bans, 6));
    const k = list.findIndex((x) => x.champ === live.myChamp);
    recordPick({ at: Date.now(), champ: live.myChamp, role: live.role, rank: k >= 0 ? k + 1 : null, top: list.slice(0, 3).map((x) => x.champ) });
  }, [live?.myLocked, live?.myChamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const account = client.status === "idle" || client.status === "champselect" ? client.account : null;
  // dernier compte vu dans le client : les stats perso restent visibles client fermé
  const [savedAccount, setSavedAccount] = usePersistent<Account | null>("spec.account", null);
  useEffect(() => {
    if (account?.puuid && (account.puuid !== savedAccount?.puuid || account.icon !== savedAccount?.icon)) setSavedAccount(account);
  }, [account?.puuid, account?.icon]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = account?.puuid ? account : savedAccount;
  const [perso, refreshPerso] = usePersonal(me?.puuid ?? null);
  const [update, installUpdate, checkUpdate] = useUpdate();
  const [compact, setCompact] = usePersistent<boolean>("spec.compact", false);
  const [onTop, setOnTopPref] = usePersistent<boolean>("spec.compact.onTop", true);

  // applique la taille de fenêtre au lancement et à chaque bascule
  const [onboarded, setOnboarded] = useOnboarded();
  const [onboarding, setOnboarding] = useState(false);
  const [replayOnboarding, setReplayOnboarding] = useState(false);
  // visite guidée « Bienvenue sur Spec » : une fois après l'accueil (et une fois pour ceux qui avaient déjà Spec)
  const [tourDone, setTourDone] = usePersistent<boolean>("spec.tour.done", false);
  const [tour, setTour] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  // début de la sélection : Spec clignote dans la barre des tâches s'il n'est pas au premier plan
  const [selectAlert] = useSelectAlert();
  const inSelect = session != null;
  useEffect(() => {
    if (inSelect && selectAlert && (document.hidden || !document.hasFocus())) requestAttention();
  }, [inSelect]); // eslint-disable-line react-hooks/exhaustive-deps
  // fenêtre compacte agrandie à la main (bouton Agrandir de Windows, bord tiré) : on repasse en affichage complet
  const expandedByUser = useRef(false);
  useEffect(() => {
    if (!compact) return;
    let stop: (() => void) | null = null, cancelled = false;
    watchCompactExpand(() => { expandedByUser.current = true; setCompact(false); }).then((u) => { if (cancelled) u(); else stop = u; });
    return () => { cancelled = true; stop?.(); };
  }, [compact]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const keep = expandedByUser.current;
    expandedByUser.current = false;
    applyCompact(compact && stats != null && !onboarding, onTop, keep);
  }, [compact, stats != null, onboarding]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTop = () => { setOnTopPref(!onTop); setOnTop(!onTop); };
  const [clientOn, clientText] = clientStatus(client);
  const doPreselect = (champ: number) => preselect(session!, champ);
  const doBan = (champ: number) => preselectBan(session!, champ);

  useEffect(() => {
    loadStats()
      .then(localizeChampions)   // noms officiels des champions dans la langue de l'interface
      .then(setStats)
      .catch(() => setError(t("Stats introuvables : lance `python -m scoring export` dans le dossier Spec.")));
  }, []);

  // accueil au premier lancement ; ceux qui ont déjà un pool (versions précédentes) ne le voient pas
  useEffect(() => {
    if (!stats) return;
    if (onboarded) { if (!tourDone) setTour(true); return; }   // déjà configuré : la visite une seule fois
    if (pools.some((p) => p.length)) { setOnboarded(true); if (!tourDone) setTour(true); }
    else setOnboarding(true);
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps
  const finishOnboarding = () => {
    setOnboarded(true);
    setOnboarding(false);
    if (!tourDone && !replayOnboarding) setTour(true);
    setReplayOnboarding(false);
    if (roles.main != null) setTierRole(roles.main);
    setScreen("draft");
  };

  const footer = useMemo(
    () => (stats ? t("Stats Master+ · patch {patchLabel} · {int} parties", { patchLabel: patchLabel(stats.meta.patch), int: int(Number(stats.meta.matches ?? 0)) }) : ""),
    [stats],
  );

  const runeImporter = live ? importRunes : null;
  const spellImporter = live ? importSpells : null;

  if (onboarding && stats) {
    return (
      <Onboarding stats={stats} roles={roles} onRoles={setRoles} pools={pools} onPools={setPools}
                  clientOn={clientOn} account={me} perso={perso} onDone={finishOnboarding} skipWelcome={replayOnboarding}
                  onRegister={async (code) => {
                    const err = me?.puuid ? await register(me.puuid, me.name, code) : t("Lance le client LoL pour lier ton compte.");
                    if (!err) refreshPerso();
                    return err;
                  }} />
    );
  }

  if (compact && stats) {
    const current = live ?? draft;
    // en partie : le menu de build remplace la draft dans la petite fenêtre
    const game = inGame ? <InGameView stats={stats} start={inGame} game={liveGame} compact /> : null;
    return (
      <RuneImportContext.Provider value={runeImporter}>
      <SpellImportContext.Provider value={spellImporter}>
      <CompactScreen stats={stats} draft={current} pool={current ? pools[current.role] : []} live={!!live}
                     onTop={onTop} clientOn={clientOn} clientText={clientText}
                     onRole={(r) => (live ? setRoleOverride(r) : draft && setDraft({ ...draft, role: r }))}
                     onToggleTop={toggleTop} onExpand={() => setCompact(false)}
                     onDemo={clientOn ? undefined : () => setDraft(demoDraft(stats))} onEndDemo={() => setDraft(null)}
                     onDemoPick={(c) => draft && setDraft({ ...draft, myChamp: c, myLocked: false })}
                     onPreselect={live ? doPreselect : undefined} onBan={live ? doBan : undefined} perso={perso} game={game}
                     onPool={onPool} />
      </SpellImportContext.Provider>
      </RuneImportContext.Provider>
    );
  }

  return (
    <RuneImportContext.Provider value={runeImporter}>
    <SpellImportContext.Provider value={spellImporter}>
    <div className="window">
      <aside className="sidebar">
        <div className="brand">
          <Logo className="brand__mark" />
          <span className="brand__name">{t("Spec")}</span>
          <button className="icon-btn brand__compact has-tip" data-tour="compact" onClick={() => setCompact(true)} disabled={!stats}
                  data-tip={t("Mode compact")} data-tip-sub={t("Petite fenêtre à côté du client")} aria-label={t("Passer en mode compact")}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
              <path d="M2 3h12v10H2zM8.5 8h4v3.5h-4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <nav>
          {SCREENS.map(([key, label]) => (
            <Fragment key={key}>
              {key === "overlay" && <span className="nav__sep" aria-hidden />}
              <button data-tour={key} className={`nav${screen === key || (key === "tier" && screen === "champion") ? " is-active" : ""}`}
                      onClick={() => setScreen(key)} aria-current={screen === key ? "page" : undefined}>
                <NavIcon screen={key} />
                <span className="nav__label">{label}</span>
                {key === "draft" && live && <span className="nav__live">{t("En direct")}</span>}
              </button>
            </Fragment>
          ))}
        </nav>
        <span className="grow" />
        <UpdateCard state={update} onInstall={installUpdate} />
        <div className="sidebar__account" title={account ? t("Compte connecté au client LoL") : undefined}>
          {account?.icon != null && stats
            ? <img className="sidebar__avatar" src={`https://ddragon.leagueoflegends.com/cdn/${stats.ddragon}/img/profileicon/${account.icon}.png`} alt="" draggable={false} />
            : <span className="sidebar__avatar sidebar__avatar--empty" />}
          <span className="sidebar__who">
            <strong>{account?.name ?? savedAccount?.name ?? t("Aucun compte")}</strong>
            <small><span className={clientOn ? "dot" : "dot dot--off"} />{clientOn ? t("Client connecté") : t("Client LoL fermé")}{account?.region ? ` · ${account.region}` : ""}</small>
          </span>
        </div>
        <p className="sidebar__legal" title={footer}>{stats ? `${t("Patch {v}", { v: patchLabel(stats.meta.patch) })} · ` : ""}{t("Spec n’est pas approuvé par Riot Games.")}</p>
        <button className="sidebar__privacy" onClick={() => setPrivacy(true)}>{t("Confidentialité")}</button>
      </aside>

      <main className="main">
        {error && <div className="content"><div className="empty-state"><h1>{t("Impossible de démarrer")}</h1><p className="muted">{error}</p></div></div>}
        {!error && !stats && <div className="content"><div className="empty-state"><div className="spinner" /><p className="muted">{t("Chargement des stats…")}</p></div></div>}
        {stats && screen === "profile" && (
          <ProfileScreen stats={stats} account={me} clientOn={clientOn} lpVersion={lpVersion}
                         perso={perso}
                         onRegister={async (code) => {
                           const err = me?.puuid ? await register(me.puuid, me.name, code) : t("Lance le client LoL pour lier ton compte.");
                           if (!err) refreshPerso();
                           return err;
                         }} />
        )}
        {stats && (screen === "tier" || (screen === "champion" && champView)) && regionStats.kind !== "ready" && (
          <RegionWait region={region} missing={regionStats.kind === "missing"} select={regionSelect} />
        )}
        {stats && screen === "tier" && regionStats.kind === "ready" && (
          <TierListScreen stats={regionStats.stats} role={tierRole} onRole={setTierRole} onOpen={openChamp}
                          region={regionSelect} regionLabel={REGION_LABEL[region]} />
        )}
        {stats && screen === "champion" && champView && regionStats.kind === "ready" && (
          <ChampionScreen stats={regionStats.stats} champ={champView.champ} role={champView.role}
                          onRole={(role) => setChampView({ ...champView, role })}
                          onBack={() => setScreen("tier")}
                          region={regionSelect} regionLabel={REGION_LABEL[region]} />
        )}
        {stats && screen === "pool" && <PoolScreen key={poolRole ?? "main"} stats={stats} pools={pools} onChange={setPools} perso={perso} initialRole={poolRole ?? roles.main ?? 2} />}
        {screen === "overlay" && <OverlayScreen settings={overlay} onChange={setOverlay} inGame={inGame != null && started} />}
        {screen === "settings" && (
          <SettingsScreen account={me} registered={perso.kind === "ready"}
                          compact={compact} onCompact={setCompact} onTop={onTop} onOnTop={setOnTopPref}
                          onCheckUpdate={checkUpdate} onReplayOnboarding={() => { setReplayOnboarding(true); setOnboarding(true); }}
                          onReplayTour={() => { setScreen("draft"); setTour(true); }}
                          onPrivacy={() => setPrivacy(true)} onDeleted={refreshPerso} />
        )}
        {stats && screen === "draft" && live && (
          <DraftScreen stats={stats} draft={live} pool={pools[live.role]} wide={wide} live
                       onChange={(d) => setRoleOverride(d.role)}
                       onPreselect={doPreselect} onBan={doBan} perso={perso} />
        )}
        {stats && screen === "draft" && !live && inGame && loadingPhase && loading && (
          <div className="content">
            <header className="page-head"><div><h1>{t("Chargement de la partie")}</h1>
              <p className="muted small">{loading.queue ? `${loading.queue} · ` : ""}{t("Patch {v}", { v: patchLabel(stats.meta.patch) })}</p></div></header>
            <LoadingCards data={loading} />
          </div>
        )}
        {stats && screen === "draft" && !live && inGame && !(loadingPhase && loading) && <InGameView stats={stats} start={inGame} game={liveGame} />}
        {stats && screen === "draft" && !live && !inGame && !draft && recap && me?.puuid && (
          <div className="content">
            <RecapView stats={stats} game={recap} me={me.puuid} lpVersion={lpVersion} onClose={() => setRecap(null)} />
          </div>
        )}
        {stats && screen === "draft" && !live && !inGame && !draft && !(recap && me?.puuid) && (
          <HomeScreen stats={stats} clientOn={clientOn} clientText={clientText} me={me?.puuid ?? null} pools={pools}
                      mainRole={roles.main} version={lpVersion} onRecap={setRecap} onHistory={() => setScreen("profile")}
                      onPool={() => setScreen("pool")} onTierList={(r) => { setTierRole(r); setScreen("tier"); }}
                      onDemo={() => setDraft(demoDraft(stats))} />
        )}
        {stats && screen === "draft" && !live && !inGame && draft && (
          <DraftScreen stats={stats} draft={draft} pool={pools[draft.role]} wide={wide}
                       onChange={setDraft} onEnd={() => setDraft(null)} perso={perso} />
        )}
      </main>
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}
      {tour && stats && (
        <Tour steps={specTour()} onClose={() => { setTour(false); setTourDone(true); }}
              onDemo={draft ? undefined : () => { setScreen("draft"); setDraft(demoDraft(stats)); }} />
      )}
    </div>
    </SpellImportContext.Provider>
    </RuneImportContext.Provider>
  );
}

/** Région choisie pas encore téléchargée (ou pas encore de données pour elle). */
function RegionWait({ region, missing, select }: { region: Region; missing: boolean; select: React.ReactNode }) {
  return (
    <div className="content">
      <header className="page-head"><div><p className="overline">{t("Stats Master+ ")}{REGION_LABEL[region]}</p><h1>{t("Tier list")}</h1></div>
        <div className="head-actions">{select}</div></header>
      <div className="empty-state">
        {missing ? (
          <>
            <h1>{t("Pas encore de stats ")}{REGION_LABEL[region]}</h1>
            <p className="muted">{t("La collecte de cette région vient de commencer : les stats arrivent au prochain calcul (toutes les 6 h).")}</p>
          </>
        ) : (
          <><div className="spinner" /><p className="muted">{t("Chargement des stats ")}{REGION_LABEL[region]}…</p></>
        )}
      </div>
    </div>
  );
}

function clientStatus(client: ClientState): [boolean, string] {
  if (client.status === "browser") return [false, t("Disponible dans l’appli Spec")];
  if (client.status === "offline") return [false, t("Lance le client LoL")];
  return [true, client.account ? t("Connecté · {name}", { name: client.account.name }) : t("Connecté")];
}

function UpdateCard({ state, onInstall }: { state: UpdateState; onInstall: () => void }) {
  if (state.kind === "none") return null;
  return (
    <div className="update" role="status">
      <p className="update__title">{t("Spec {version} est disponible", { version: state.version })}</p>
      {state.kind === "available" && (
        <button className="btn btn--primary btn--small update__btn" onClick={onInstall}>{t("Installer et redémarrer")}</button>
      )}
      {state.kind === "installing" && (
        <p className="muted small">{t("Téléchargement")}{state.percent != null ? ` · ${state.percent}%` : "…"}</p>
      )}
      {state.kind === "error" && (
        <>
          <p className="small tone-bad">{t("La mise à jour a échoué.")}</p>
          <button className="btn btn--secondary btn--small update__btn" onClick={onInstall}>{t("Réessayer")}</button>
        </>
      )}
    </div>
  );
}
