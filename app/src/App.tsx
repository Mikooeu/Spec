import { useEffect, useMemo, useRef, useState } from "react";
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
import { useLpTracking } from "./lib/history";
import { type Stats } from "./lib/score";
import { loadStats, register, usePersonal } from "./lib/api";
import { int, normalize, patchLabel, usePersistent, useUiScale } from "./lib/ui";
import { importRunes, preselect, preselectBan, sessionToDraft, useLolClient, type Account, type ClientState } from "./lib/lcu";
import { RuneImportContext } from "./components/Runes";
import { applyCompact, setOnTop } from "./lib/window";
import { CompactScreen } from "./components/CompactScreen";
import { useUpdate, type UpdateState } from "./lib/updater";
import { Logo } from "./components/Logo";

type Screen = "draft" | "profile" | "tier" | "pool" | "champion";
interface ChampView { champ: number; role: number; inGame: boolean }
const SCREENS: [Screen, string][] = [["draft", "Draft"], ["profile", "Profil"], ["tier", "Tier list"], ["pool", "Pool"]];

/** Draft fictive de démonstration (remplacée plus tard par la lecture du client LoL). */
function demoDraft(stats: Stats): Draft {
  const id = (name: string) =>
    [...stats.champions.values()].find((c) => normalize(c.name) === normalize(name))?.id ?? null;
  return {
    role: 2,
    allies: [id("Darius"), id("Vi"), null, id("Jinx"), null],
    enemies: [id("Sylas"), id("Lee Sin"), id("Syndra"), null, id("Nautilus")],
    bans: [],
  };
}

export default function App() {
  const wide = useUiScale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("draft");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pools, setPools] = usePersistent<Pools>("spec.pools", [[], [], [], [], []]);
  const client = useLolClient();
  const [roleOverride, setRoleOverride] = useState<number | null>(null);

  const session = client.status === "champselect" ? client.session : null;
  useEffect(() => { if (!session) setRoleOverride(null); }, [session == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = session ? sessionToDraft(session, roleOverride) : null;
  const [tierRole, setTierRole] = useState(0);
  const [champView, setChampView] = useState<ChampView | null>(null);
  const lpVersion = useLpTracking(client);
  const openChamp = (champ: number, role: number) => { setChampView({ champ, role, inGame: false }); setScreen("champion"); };

  // pick verrouillé pendant la draft : sa page champion s'ouvre au lancement de la partie
  // (noté à chaque rendu : un effet séparé se ferait écraser par la remise à zéro du début de draft)
  const lastPick = useRef<{ champ: number; role: number } | null>(null);
  const phase = client.status === "idle" ? client.phase : client.status;
  useEffect(() => {
    if (live?.myLocked && live.myChamp != null) lastPick.current = { champ: live.myChamp, role: live.role };
  });
  useEffect(() => {
    if (phase === "champselect") { setScreen("draft"); lastPick.current = null; return; }
    if ((phase === "InProgress" || phase === "GameStart") && lastPick.current) {
      setChampView({ ...lastPick.current, inGame: true });
      setScreen("champion");
      lastPick.current = null;
      return;
    }
    // partie terminée : retour sur l'écran d'attente de la draft
    if (["PreEndOfGame", "EndOfGame", "WaitingForStats", "Lobby", "None", "offline"].includes(phase)) {
      setChampView((v) => {
        if (v?.inGame) setScreen((sc) => (sc === "champion" ? "draft" : sc));
        return v?.inGame ? { ...v, inGame: false } : v;
      });
    }
  }, [phase]);
  const account = client.status === "idle" || client.status === "champselect" ? client.account : null;
  // dernier compte vu dans le client : les stats perso restent visibles client fermé
  const [savedAccount, setSavedAccount] = usePersistent<Account | null>("spec.account", null);
  useEffect(() => {
    if (account?.puuid && (account.puuid !== savedAccount?.puuid || account.icon !== savedAccount?.icon)) setSavedAccount(account);
  }, [account?.puuid, account?.icon]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = account?.puuid ? account : savedAccount;
  const [perso, refreshPerso] = usePersonal(me?.puuid ?? null);
  const [update, installUpdate] = useUpdate();
  const [compact, setCompact] = usePersistent<boolean>("spec.compact", false);
  const [onTop, setOnTopPref] = usePersistent<boolean>("spec.compact.onTop", true);

  // applique la taille de fenêtre au lancement et à chaque bascule
  useEffect(() => { applyCompact(compact && stats != null, onTop); }, [compact, stats != null]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTop = () => { setOnTopPref(!onTop); setOnTop(!onTop); };
  const [clientOn, clientText] = clientStatus(client);
  const doPreselect = (champ: number) => preselect(session!, champ);
  const doBan = (champ: number) => preselectBan(session!, champ);

  useEffect(() => {
    loadStats()
      .then(setStats)
      .catch(() => setError("Stats introuvables : lance `python -m scoring export` dans le dossier Spec."));
  }, []);

  // pool de démo au premier lancement, pour voir tout de suite des recommandations
  useEffect(() => {
    if (!stats || pools.some((p) => p.length)) return;
    const ids = ["Ahri", "Orianna", "Viktor"]
      .map((n) => [...stats.champions.values()].find((c) => c.name === n)?.id)
      .filter((x): x is number => x != null);
    setPools([[], [], ids, [], []]);
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const footer = useMemo(
    () => (stats ? `Stats Master+ · patch ${patchLabel(stats.meta.patch)} · ${int(Number(stats.meta.matches ?? 0))} parties` : ""),
    [stats],
  );

  const runeImporter = live ? importRunes : null;

  if (compact && stats) {
    const current = live ?? draft;
    return (
      <RuneImportContext.Provider value={runeImporter}>
      <CompactScreen stats={stats} draft={current} pool={current ? pools[current.role] : []} live={!!live}
                     onTop={onTop} clientOn={clientOn} clientText={clientText}
                     onRole={(r) => (live ? setRoleOverride(r) : draft && setDraft({ ...draft, role: r }))}
                     onToggleTop={toggleTop} onExpand={() => setCompact(false)}
                     onDemo={clientOn ? undefined : () => setDraft(demoDraft(stats))} onEndDemo={() => setDraft(null)}
                     onDemoPick={(c) => draft && setDraft({ ...draft, myChamp: c, myLocked: false })}
                     onPreselect={live ? doPreselect : undefined} onBan={live ? doBan : undefined} perso={perso} />
      </RuneImportContext.Provider>
    );
  }

  return (
    <RuneImportContext.Provider value={runeImporter}>
    <div className="window">
      <aside className="sidebar">
        <div className="brand">
          <Logo className="brand__mark" />
          <span className="brand__name">Spec</span>
          <button className="icon-btn brand__compact" onClick={() => setCompact(true)} disabled={!stats}
                  title="Mode compact" aria-label="Passer en mode compact">
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
              <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14" fill="none" stroke="currentColor"
                    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <nav>
          {SCREENS.map(([key, label]) => (
            <button key={key} className={`nav${screen === key || (key === "tier" && screen === "champion") ? " is-active" : ""}`}
                    onClick={() => setScreen(key)} aria-current={screen === key ? "page" : undefined}>{label}</button>
          ))}
        </nav>
        <span className="grow" />
        <UpdateCard state={update} onInstall={installUpdate} />
        {account && (
          <p className="sidebar__account" title="Compte connecté au client LoL">
            <span className="dot" />{account.name}{account.region ? ` · ${account.region}` : ""}
          </p>
        )}
        <p className="sidebar__foot">{footer}</p>
        <p className="sidebar__legal">Spec n’est pas approuvé par Riot Games.</p>
      </aside>

      <main className="main">
        {error && <div className="content"><div className="empty-state"><h1>Impossible de démarrer</h1><p className="muted">{error}</p></div></div>}
        {!error && !stats && <div className="content"><div className="empty-state"><div className="spinner" /><p className="muted">Chargement des stats…</p></div></div>}
        {stats && screen === "profile" && (
          <ProfileScreen stats={stats} account={me} clientOn={clientOn} lpVersion={lpVersion}
                         perso={perso}
                         onRegister={async (code) => {
                           const err = me?.puuid ? await register(me.puuid, me.name, code) : "Lance le client LoL pour lier ton compte.";
                           if (!err) refreshPerso();
                           return err;
                         }} />
        )}
        {stats && screen === "tier" && <TierListScreen stats={stats} role={tierRole} onRole={setTierRole} onOpen={openChamp} />}
        {stats && screen === "champion" && champView && (
          <ChampionScreen stats={stats} champ={champView.champ} role={champView.role} inGame={champView.inGame}
                          onRole={(role) => setChampView({ ...champView, role })}
                          onBack={() => setScreen(champView.inGame ? "draft" : "tier")} />
        )}
        {stats && screen === "pool" && <PoolScreen stats={stats} pools={pools} onChange={setPools} perso={perso} />}
        {stats && screen === "draft" && live && (
          <DraftScreen stats={stats} draft={live} pool={pools[live.role]} wide={wide} live
                       onChange={(d) => setRoleOverride(d.role)}
                       onPreselect={doPreselect} onBan={doBan} perso={perso} />
        )}
        {stats && screen === "draft" && !live && !draft && (
          <div className="content">
            <div className="empty-state">
              <div className="spinner" />
              <h1>En attente de la draft</h1>
              <p className="muted">Lance une partie classée : tes recommandations s’affichent dès la sélection des champions.</p>
              <div className="card status-list">
                <div><span>Client LoL</span><span className="muted"><span className={clientOn ? "dot" : "dot dot--off"} />{clientText}</span></div>
                <div><span>Stats Master+</span><span className="muted"><span className="dot" />Patch {patchLabel(stats.meta.patch)}</span></div>
              </div>
              {!clientOn && (
                <button className="btn btn--primary" onClick={() => setDraft(demoDraft(stats))}>Simuler une draft</button>
              )}
            </div>
          </div>
        )}
        {stats && screen === "draft" && !live && draft && (
          <DraftScreen stats={stats} draft={draft} pool={pools[draft.role]} wide={wide}
                       onChange={setDraft} onEnd={() => setDraft(null)} perso={perso} />
        )}
      </main>
    </div>
    </RuneImportContext.Provider>
  );
}

function clientStatus(client: ClientState): [boolean, string] {
  if (client.status === "browser") return [false, "Disponible dans l’appli Spec"];
  if (client.status === "offline") return [false, "Lance le client LoL"];
  return [true, client.account ? `Connecté · ${client.account.name}` : "Connecté"];
}

function UpdateCard({ state, onInstall }: { state: UpdateState; onInstall: () => void }) {
  if (state.kind === "none") return null;
  return (
    <div className="update" role="status">
      <p className="update__title">Spec {state.version} est disponible</p>
      {state.kind === "available" && (
        <button className="btn btn--primary btn--small update__btn" onClick={onInstall}>Installer et redémarrer</button>
      )}
      {state.kind === "installing" && (
        <p className="muted small">Téléchargement{state.percent != null ? ` · ${state.percent} %` : "…"}</p>
      )}
      {state.kind === "error" && (
        <>
          <p className="small tone-bad">La mise à jour a échoué.</p>
          <button className="btn btn--secondary btn--small update__btn" onClick={onInstall}>Réessayer</button>
        </>
      )}
    </div>
  );
}
