import { useEffect, useMemo, useState } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import { DraftScreen, type Draft } from "./components/DraftScreen";
import { ProfileScreen, type Pools } from "./components/ProfileScreen";
import { type Stats } from "./lib/score";
import { loadStats, register, usePersonal } from "./lib/api";
import { int, normalize, patchLabel, usePersistent, useUiScale } from "./lib/ui";
import { preselect, sessionToDraft, useLolClient, type Account, type ClientState } from "./lib/lcu";
import { applyCompact, setOnTop } from "./lib/window";
import { CompactScreen } from "./components/CompactScreen";
import { useUpdate, type UpdateState } from "./lib/updater";

type Screen = "draft" | "profile";

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
  const account = client.status === "idle" || client.status === "champselect" ? client.account : null;
  // dernier compte vu dans le client : les stats perso restent visibles client fermé
  const [savedAccount, setSavedAccount] = usePersistent<Account | null>("spec.account", null);
  useEffect(() => {
    if (account?.puuid && account.puuid !== savedAccount?.puuid) setSavedAccount(account);
  }, [account?.puuid]); // eslint-disable-line react-hooks/exhaustive-deps
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

  if (compact && stats) {
    const current = live ?? draft;
    return (
      <CompactScreen stats={stats} draft={current} pool={current ? pools[current.role] : []} live={!!live}
                     onTop={onTop} clientOn={clientOn} clientText={clientText}
                     onRole={(r) => (live ? setRoleOverride(r) : draft && setDraft({ ...draft, role: r }))}
                     onToggleTop={toggleTop} onExpand={() => setCompact(false)}
                     onDemo={() => setDraft(demoDraft(stats))} onEndDemo={() => setDraft(null)}
                     onPreselect={live ? doPreselect : undefined} perso={perso} />
    );
  }

  return (
    <div className="window">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>S</span>
          <span className="brand__name">Spec</span>
        </div>
        <nav>
          <button className={`nav${screen === "draft" ? " is-active" : ""}`} onClick={() => setScreen("draft")}>Draft</button>
          <button className={`nav${screen === "profile" ? " is-active" : ""}`} onClick={() => setScreen("profile")}>Profil et pool</button>
        </nav>
        <span className="grow" />
        <UpdateCard state={update} onInstall={installUpdate} />
        <button className="nav nav--compact" onClick={() => setCompact(true)} disabled={!stats}>Mode compact</button>
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
          <ProfileScreen stats={stats} pools={pools} onChange={setPools} account={me} clientOn={clientOn}
                         perso={perso}
                         onRegister={async (code) => {
                           const err = me?.puuid ? await register(me.puuid, me.name, code) : "Lance le client LoL pour lier ton compte.";
                           if (!err) refreshPerso();
                           return err;
                         }} />
        )}
        {stats && screen === "draft" && live && (
          <DraftScreen stats={stats} draft={live} pool={pools[live.role]} wide={wide} live
                       onChange={(d) => setRoleOverride(d.role)} onCompact={() => setCompact(true)}
                       onPreselect={doPreselect} perso={perso} />
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
              <button className="btn btn--primary" onClick={() => setDraft(demoDraft(stats))}>Simuler une draft</button>
            </div>
          </div>
        )}
        {stats && screen === "draft" && !live && draft && (
          <DraftScreen stats={stats} draft={draft} pool={pools[draft.role]} wide={wide}
                       onChange={setDraft} onEnd={() => setDraft(null)} onCompact={() => setCompact(true)} perso={perso} />
        )}
      </main>
    </div>
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
