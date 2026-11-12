import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, dec1, int, pct, usePersistent, wrTone } from "../lib/ui";
import type { PersonalState, Personal } from "../lib/api";
import type { Account } from "../lib/lcu";
import { ChampionIcon } from "./ChampionIcon";
import { TIER_COLOR } from "../lib/ui";
import { RecapView } from "./RecapView";
import { InButton } from "./Runes";
import { Rune, useRuneData, type RuneData } from "./Runes";
import { loadItems, loadSpells, useInfo, type InfoMap } from "../lib/ddragon";
import { IMPACT_MIN, IMPACT_RELIABLE, impact, recaps, settle, type Recap } from "../lib/impact";
import { Trend } from "./Trend";
import {
  QUEUE_LABELS, duoPartner, loadDuos, type Duo, findPlayer, loadGameDetail, loadHistory, loadPlayer, loadServerHistory, mergeHistory, rankText, rankTier,
  readRanked, readLpSeries, noteSoloLp, rankedType5c5, lpLabel, type LpPoint, type LpQueue, type Game, type GameDetail, type OtherPlayer, type PlayerLine, type QueueKind,
} from "../lib/history";
import { noteText, noteTone, rateGame, sortedParts, summaryParts, type Contribution, type Criterion, type Rating } from "../lib/rating";
import { Segmented } from "./Segmented";
import { StatsView } from "./StatsView";
import { loadSeasonStats, statsOf, type SeasonStats } from "../lib/seasonStats";
import { t, locale, ordinal, plural } from "../lib/i18n";

export type { Pools } from "./PoolScreen";

interface Props {
  stats: Stats;
  account: Account | null;
  clientOn: boolean;
  perso: PersonalState;
  onRegister: (code: string) => Promise<string | null>;
  /** Change quand un nouvel écart de LP est enregistré : l'historique est relu. */
  lpVersion: number;
}

type Guess = import("../lib/history").Guess;

/** Poste probable d'après les parties Master+, quand le client ne le donne pas. */
function useGuess(stats: Stats): Guess {
  return useMemo(() => Object.assign((champ: number, notJungle: boolean) => {
    const dist = stats.roleGames.get(champ);
    if (!dist) return null;
    let best: number | null = null;
    dist.forEach((g, r) => { if ((!notJungle || r !== 1) && g > 0 && (best == null || g > dist[best])) best = r; });
    return best;
  }, { dist: (champ: number) => stats.roleGames.get(champ) ?? null }), [stats]);
}

/** Données d'affichage partagées par les lignes d'historique et le détail des parties. */
interface Assets { items: InfoMap | null; spells: InfoMap | null; runes: RuneData | null }

/** Profil : recherche d'un joueur, compte, stats perso, meilleurs picks, historique détaillé. */
export function ProfileScreen({ stats, account, clientOn, perso, onRegister, lpVersion }: Props) {
  const [viewing, setViewing] = useState<string | null>(null);   // identifiant client d'un autre joueur
  const assets: Assets = {
    items: useInfo(loadItems, stats.ddragon), spells: useInfo(loadSpells, stats.ddragon), runes: useRuneData(stats.ddragon),
  };
  const open = (puuid: string | null) => {
    if (!puuid) return;
    setViewing(puuid === account?.puuid ? null : puuid);
    document.querySelector(".main")?.scrollTo({ top: 0 });
  };
  return (
    <div className="content">
      <header className="page-head profile-head">
        <div>{viewing ? <button className="link-back" onClick={() => setViewing(null)}>{t("← Ton profil")}</button> : <h1>{t("Ton profil")}</h1>}</div>
        <PlayerSearch region={account?.region ?? null} clientOn={clientOn} onFound={open} />
      </header>
      <div key={viewing ?? "me"} className="profile-view fade-in">
      {viewing
        ? <OtherProfile key={viewing} stats={stats} puuid={viewing} me={account?.puuid ?? null} assets={assets}
                        onBack={() => setViewing(null)} onOpenPlayer={open} />
        : <OwnProfile stats={stats} account={account} clientOn={clientOn} perso={perso} onRegister={onRegister}
                      lpVersion={lpVersion} assets={assets} onOpenPlayer={open} />}
      </div>
    </div>
  );
}

function PlayerSearch({ region, clientOn, onFound }: { region: string | null; clientOn: boolean; onFound: (puuid: string) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async () => {
    if (!query.trim()) return;
    if (!clientOn) { setError(t("Lance le client LoL pour chercher un joueur.")); return; }
    setBusy(true);
    const r = await findPlayer(query);
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    setError(null);
    setQuery("");
    onFound(r.puuid);
  };
  return (
    <div className="psearch-wrap">
      <form className="psearch" onSubmit={(e) => { e.preventDefault(); search(); }} role="search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className="psearch__lens">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input className="psearch__input" placeholder={t("Rechercher un joueur : Pseudo#TAG")} value={query}
               aria-label={t("Rechercher un joueur par son Riot ID")} spellCheck={false}
               onChange={(e) => { setQuery(e.target.value); setError(null); }}
               onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setError(null); } }} />
        {busy && <span className="muted small">{t("Recherche…")}</span>}
        <span className="psearch__region" title={t("La recherche passe par le client LoL : joueurs de ce serveur seulement")}>
          {region ?? "—"}
        </span>
      </form>
      {error && <p className="small tone-bad" role="alert">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Ton profil

function OwnProfile({ stats, account, clientOn, perso, onRegister, lpVersion, assets, onOpenPlayer }:
  Omit<Props, never> & { assets: Assets; onOpenPlayer: (puuid: string | null) => void }) {
  const guess = useGuess(stats);
  const [clientGames, setClientGames] = useState<Game[] | null>(null);
  const [serverGames, setServerGames] = useState<Game[]>([]);
  const [more, setMore] = useState<"idle" | "loading" | "end">("idle");
  const [rank, setRank] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("history");   // le profil s'ouvre toujours sur l'historique
  const [queue, setQueue] = usePersistent<"all" | QueueKind>("spec.profileQueue", "all");   // partagée par Historique et Stats
  const [lpQueue, setLpQueue] = usePersistent<LpQueue>("spec.lpQueue", "solo");   // courbe des LP : Solo/Duo ou Flex
  const [queueTiers, setQueueTiers] = useState<{ flex: string | null; "5c5": string | null }>({ flex: null, "5c5": null });
  const [season, setSeason] = useState<SeasonStats | null>(null);
  const [seasonFailed, setSeasonFailed] = useState(false);
  const [duo, setDuo] = useState<DuoFilter | null>(null);
  const [duoGames, setDuoGames] = useState<Game[] | null>(null);
  const [impactVersion, setImpactVersion] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);   // partie à déplier en ouvrant l’historique
  const registered = perso.kind === "ready";
  // compte déjà vu lié sur ce PC : l'onglet Duo reste visible même si le serveur ne répond pas pour l'instant
  const [linked, setLinked] = usePersistent<string | null>("spec.linked", null);
  useEffect(() => { if (registered && account?.puuid && linked !== account.puuid) setLinked(account.puuid); }, [registered, account?.puuid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [seriesTick, setSeriesTick] = useState(0);
  const showDuo = registered || (perso.kind === "error" && !!account?.puuid && linked === account.puuid);

  useEffect(() => {
    if (!clientOn) return;
    let alive = true;
    // Juste après son lancement, le client LoL peut refuser l'historique : on réessaie quelques fois
    // (sinon seules les parties Solo/Duo du serveur s'affichent, sans erreur visible).
    let timer: number | undefined;
    const fetchClient = (attempt: number) => {
      loadHistory(50, guess).then((g) => { if (alive) { setClientGames(g); setHistoryError(false); } })
        .catch((e) => {
          console.warn("[history] client", e);
          if (!alive) return;
          if (attempt < 4) timer = window.setTimeout(() => fetchClient(attempt + 1), 3000 * (attempt + 1));
          else setHistoryError(true);
        });
    };
    fetchClient(0);
    readRanked().then((r) => {
      noteSoloLp(r).then(() => alive && setSeriesTick((n) => n + 1));   // la courbe suit le compte connecté
      if (alive) { setRank(rankText(r?.queueMap?.RANKED_SOLO_5x5)); setTier(rankTier(r?.queueMap?.RANKED_SOLO_5x5)); }
      rankedType5c5().catch(() => null).then((type5) => alive && setQueueTiers({
        flex: rankTier(r?.queueMap?.RANKED_FLEX_SR) ?? null, "5c5": type5 ? rankTier(r?.queueMap?.[type5]) ?? null : null }));
    });
    return () => { alive = false; window.clearTimeout(timer); };
  }, [clientOn, lpVersion, guess, historyRetry]);

  // historique complet de la saison (Solo/Duo) gardé par le serveur Spec
  useEffect(() => {
    if (!registered || !account?.puuid) return;
    let alive = true;
    loadServerHistory(account.puuid).then((g) => {
      if (!alive) return;
      setServerGames(g);
      setMore(g.length < 20 ? "end" : "idle");
    }).catch((e) => console.warn("[history] serveur", e));
    return () => { alive = false; };
  }, [registered, account?.puuid, lpVersion]);

  const loadMore = async () => {
    if (!account?.puuid || !serverGames.length) return;
    setMore("loading");
    try {
      const next = await loadServerHistory(account.puuid, serverGames[serverGames.length - 1].created);
      setServerGames([...serverGames, ...next]);
      setMore(next.length < 20 ? "end" : "idle");
    } catch { setMore("idle"); }
  };

  const games = clientGames || serverGames.length ? mergeHistory(clientGames ?? [], serverGames) : null;
  const inQueue = (list: Game[]) => list.filter((g) => (queue === "all" ? g.queue !== "other" : g.queue === queue));
  const queueCount = (q: "all" | QueueKind) => (games ?? []).filter((g) => (q === "all" ? g.queue !== "other" : g.queue === q)).length;
  // totaux de la saison (Solo/Duo, serveur) : relus à l'ouverture de l'onglet Stats
  const wantSeason = queue === "solo" && registered && !!account?.puuid;
  // serveur injoignable (ou pas encore à jour) : on se rabat sur les dernières parties chargées
  const useSeason = wantSeason && !seasonFailed;
  useEffect(() => {
    if (tab !== "stats" || !wantSeason || !account?.puuid) return;
    let alive = true;
    loadSeasonStats(account.puuid).then((d) => { if (alive) { setSeason(d); setSeasonFailed(false); } })
      .catch((e) => { console.warn("[stats] serveur", e); if (alive) setSeasonFailed(true); });
    return () => { alive = false; };
  }, [tab, wantSeason, account?.puuid, lpVersion]);
  const recent = games ? inQueue(games) : [];
  const statsData = useSeason ? season : games ? statsOf(recent) : null;
  const recentNote = useSeason ? null
    : queue === "flex" || queue === "5c5" ? t("Sur tes {n} dernières parties seulement", { n: recent.length })
    : queue === "all" ? t("Toutes files, sur tes {n} dernières parties", { n: recent.length })
    : wantSeason ? t("Sur tes {n} dernières parties : le serveur Spec ne répond pas pour l’instant.", { n: recent.length })
    : t("Sur tes {n} dernières parties : active tes stats perso pour toute la saison.", { n: recent.length });
  // picks notés au lock : on les relie aux parties terminées
  useEffect(() => { if (games && settle(games)) setImpactVersion((v) => v + 1); }, [games?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // historique filtré sur un partenaire de duo (toutes vos parties ensemble, depuis le serveur)
  useEffect(() => {
    if (!duo || !account?.puuid) { setDuoGames(null); return; }
    let alive = true;
    setDuoGames(null);
    loadServerHistory(account.puuid, undefined, 50, duo.key).then((g) => alive && setDuoGames(g)).catch(() => alive && setDuoGames([]));
    return () => { alive = false; };
  }, [duo?.key, account?.puuid]); // eslint-disable-line react-hooks/exhaustive-deps
  const openDuo = (f: DuoFilter) => { setDuo(f); setTab("history"); };
  const openGame = (id: number) => { setDuo(null); setRole(null); setFocus(id); setTab("history"); };
  const activate = async () => {
    setBusy(true);
    setMessage(await onRegister(code));
    setBusy(false);
  };

  return (
    <>
      {/* bandeau : compte, rang, statut et chiffres de la saison (au lieu d'une carte et de 3 tuiles) */}
      <div className="card account account--band">
        <span className="account__avatar">
          <ProfileIcon version={stats.ddragon} icon={account?.icon ?? null} size={3.25} />
          {account?.level != null && <span className="account__level">{account.level}</span>}
        </span>
        <div className="grow account__who">
          <p className="account__name">{account ? account.name : t("Aucun compte lié")}{account?.region && <span className="account__region">{account.region}</span>}</p>
          {rank && <RankLine tier={tier} rank={rank} />}
          <p className="muted small account__status"><span className={clientOn ? "dot" : "dot dot--off"} />
            {clientOn ? t("Client connecté") : t("Client LoL fermé")} · {persoText(perso).split(" · ")[0]}</p>
        </div>
        {perso.kind === "ready" && <SeasonTiles stats={stats} data={perso.data} games={games} />}
      </div>

      {perso.kind === "unregistered" && (
        <form className="card activate" onSubmit={(e) => { e.preventDefault(); if (code.trim()) activate(); }}>
          <div className="grow">
            <p className="account__name">{t("Stats perso")}</p>
            <p className="muted small">{t("Entre le code d’activation reçu pour voir tes winrates personnels dans la draft.")}</p>
            {message && <p className="small tone-bad" role="alert">{message}</p>}
          </div>
          <input className="search search--code" placeholder="XXXX-XXXX" value={code} maxLength={9}
                 autoCapitalize="characters" spellCheck={false} aria-label={t("Code d’activation")}
                 onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn btn--primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? t("Activation…") : t("Activer")}
          </button>
        </form>
      )}

      <ProfileTabs tab={tab} onTab={setTab} tabs={showDuo ? ["history", "stats", "progress", "duo"] : ["history", "stats", "progress"]}
                   extra={(tab === "history" && !duo) || tab === "stats" ? <>
                     <QueueFilter queue={queue} onQueue={setQueue} count={queueCount} />
                     <RoleFilter role={role} onRole={setRole} games={games ? inQueue(games) : []} />
                   </> : tab === "progress" ? (
                     <Select label={t("File")} value={lpQueue} onChange={(v) => setLpQueue(v as LpQueue)}
                             options={[["solo", QUEUE_LABELS.solo], ["flex", QUEUE_LABELS.flex], ["5c5", QUEUE_LABELS["5c5"]]]} />
                   ) : null} />

      <div key={tab} className="profile-view fade-in">
      {tab === "history" && (
        <History stats={stats} games={duo ? duoGames : games} assets={assets} role={role} onRole={setRole} me={account?.puuid ?? null}
                 queue={duo ? undefined : queue}
                 intro={duo ? t("Vos {games} parties ensemble en Solo/Duo, de la plus récente à la plus ancienne.", { games: duo.games })
                   : registered ? null
                   : t("Tes dernières parties. Clique sur une partie pour voir le détail des 10 joueurs. Active tes stats perso pour retrouver toute ta saison.")}
                 empty={!clientOn && !games ? t("Lance le client LoL pour voir ton historique.") : null}
                 error={historyError && !serverGames.length ? t("Le client LoL n’a pas renvoyé ton historique. Réessaie dans un instant.") : null}
                 notice={historyError && serverGames.length > 0 && !duo ? (
                   <p className="hint history__notice">
                     {t("Seules tes parties Solo/Duo s’affichent : le client LoL n’a pas renvoyé les autres.")}{" "}
                     <button className="link-btn" onClick={() => { setHistoryError(false); setHistoryRetry((n) => n + 1); }}>{t("Réessayer")}</button>
                   </p>
                 ) : null}
                 onOpenPlayer={onOpenPlayer} showLp duo={duo} onClearDuo={() => setDuo(null)} focus={focus}
                 footer={!duo && registered && serverGames.length > 0 && more !== "end" ? (
                   <button className="btn btn--secondary btn--small history__more" onClick={loadMore} disabled={more === "loading"}>
                     {more === "loading" ? t("Chargement…") : t("Afficher plus de parties")}
                   </button>
                 ) : null} />
      )}
      {tab === "stats" && (
        <>
          <StatsView stats={stats} data={statsData} laneGames={clientGames ? inQueue(clientGames) : []}
                     me={account?.puuid ?? null} guess={guess} recentNote={recentNote} role={role} />
          <ImpactCard version={impactVersion} />
        </>
      )}
      {tab === "progress" && (
        <ProgressView stats={stats} games={games} perso={perso} queue={lpQueue} tier={lpQueue === "solo" ? tier : queueTiers[lpQueue]}
                      version={lpVersion + impactVersion + seriesTick} onOpenGame={openGame} />
      )}
      {tab === "duo" && account?.puuid && (
        <DuoList stats={stats} client={account.puuid} selected={duo?.key ?? null} onOpen={openDuo} />
      )}
      </div>
    </>
  );
}

/** Winrate de la saison, champion le plus joué, rôle principal ou LP de la semaine. */
function SeasonTiles({ stats, data, games: history }: { stats: Stats; data: Personal; games: Game[] | null }) {
  let games = 0, wins = 0;
  for (const [g, w] of data.byChamp.values()) { games += g; wins += w; }
  const top = [...data.byChamp.entries()].sort((a, b) => b[1][0] - a[1][0])[0];
  const byRole = [0, 0, 0, 0, 0];
  for (const [, r, g] of data.champions) if (r >= 0) byRole[r] += g;
  const mainRole = byRole.indexOf(Math.max(...byRole));
  if (!games) return null;
  const week = (history ?? []).filter((g) => g.lp != null && Date.now() - g.created < 7 * 86400_000);
  const total = week.reduce((a, g) => a + (g.lp ?? 0), 0);
  return (
    <div className="account__kpis">
      <Kpi label={t("Winrate saison")} value={pct(wins / games)} detail={t("{int} parties classées", { int: int(games) })} />
      <Kpi label={t("Le plus joué")} stats={stats} champ={top?.[0]}
           value={top ? champName(stats, top[0]) : "—"}
           detail={top ? t("{pct} · {n} parties", { pct: pct(top[1][1] / top[1][0]), n: int(top[1][0]) }) : ""} />
      {week.length
        ? <Kpi label={t("LP cette semaine")} value={lpText(total)} tone={total > 0 ? "good" : total < 0 ? "bad" : "neutral"}
               detail={plural(week.length, "{n} partie suivie", "{n} parties suivies")} />
        : <Kpi label={t("Rôle principal")} value={ROLE_LABELS[mainRole]} detail={t("{pct} de tes parties", { pct: pct(byRole[mainRole] / games) })} />}
    </div>
  );
}

function Kpi({ label, value, detail, tone, stats, champ }:
  { label: string; value: string; detail: string; tone?: string; stats?: Stats; champ?: number }) {
  return (
    <div className="account__kpi">
      <span className="account__kpi-label">{label}</span>
      <span className={`account__kpi-value${tone ? ` tone-${tone}` : ""}`}>
        {stats && champ != null && <ChampionIcon stats={stats} champ={champ} size={1.25} />}{value}
      </span>
      <span className="account__kpi-detail">{detail}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Profil d'un autre joueur (via le client LoL)

function OtherProfile({ stats, puuid, me, assets, onOpenPlayer }:
  { stats: Stats; puuid: string; me: string | null; assets: Assets; onBack: () => void; onOpenPlayer: (puuid: string | null) => void }) {
  const guess = useGuess(stats);
  const [player, setPlayer] = useState<OtherPlayer | null>(null);
  const [error, setError] = useState(false);
  const [role, setRole] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("history");
  const [queue, setQueue] = useState<"all" | QueueKind>("all");
  useEffect(() => {
    let alive = true;
    loadPlayer(puuid, guess).then((p) => alive && setPlayer(p)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [puuid, guess]);

  const ranked = (player?.games ?? []).filter((g) => !g.remake && g.queue !== "other");
  const wins = ranked.filter((g) => g.win).length;
  const counts = new Map<number, number>();
  const roles = [0, 0, 0, 0, 0];
  for (const g of ranked) {
    counts.set(g.champ, (counts.get(g.champ) ?? 0) + 1);
    if (g.role != null) roles[g.role] += 1;
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const mainRole = roles.indexOf(Math.max(...roles));
  const inQueue = (player?.games ?? []).filter((g) => (queue === "all" ? g.queue !== "other" : g.queue === queue));
  const queueCount = (q: "all" | QueueKind) => (player?.games ?? []).filter((g) => (q === "all" ? g.queue !== "other" : g.queue === q)).length;

  return (
    <>
      {!player && !error && <div className="skeleton" aria-label={t("Chargement du profil")}><span /><span /></div>}
      {error && <p className="hint">{t("Le client LoL n’a pas renvoyé ce profil. Vérifie qu’il est ouvert, puis réessaie.")}</p>}
      {player && (
        <>
          <div className="card account account--band">
            <span className="account__avatar"><ProfileIcon version={stats.ddragon} icon={player.icon} size={3.25} /></span>
            <div className="grow account__who">
              <p className="account__name">{player.name}</p>
              {player.rank ? <RankLine tier={player.tier} rank={player.rank} /> : <p className="account__rank">{t("Non classé en Solo/Duo")}</p>}
              <p className="muted small account__status">{ranked.length > 0 ? t("Sur ses {n} dernières parties", { n: ranked.length }) : t("Via le client LoL")}</p>
            </div>
            {ranked.length > 0 && (
              <div className="account__kpis">
                <Kpi label={t("Winrate récent")} value={pct(wins / ranked.length)} tone={wrTone(wins / ranked.length)}
                     detail={t("{w} V – {l} D", { w: wins, l: ranked.length - wins })} />
                <Kpi label={t("Le plus joué")} stats={stats} champ={top?.[0]} value={top ? champName(stats, top[0]) : "—"}
                     detail={top ? plural(top[1], "{n} partie", "{n} parties") : ""} />
                <Kpi label={t("Rôle principal")} value={roles[mainRole] ? ROLE_LABELS[mainRole] : "—"}
                     detail={roles[mainRole] ? plural(roles[mainRole], "{n} partie", "{n} parties") : ""} />
              </div>
            )}
          </div>
          <ProfileTabs tab={tab} onTab={setTab} tabs={["history", "stats"]}
                       extra={<>
                         <QueueFilter queue={queue} onQueue={setQueue} count={queueCount} />
                         <RoleFilter role={role} onRole={setRole} games={inQueue} />
                       </>} />
          <div key={tab} className="profile-view fade-in">
          {tab === "stats" && (
            // mêmes stats que ton profil, calculées sur ses dernières parties renvoyées par le client
            <StatsView stats={stats} data={statsOf(inQueue)} laneGames={inQueue} me={puuid} guess={guess} recentNote={null} other role={role} />
          )}
          {tab === "history" && (
            <History stats={stats} games={player.games} assets={assets} role={role} onRole={setRole} me={me}
                     intro={null} queue={queue}
                     onOpenPlayer={onOpenPlayer} subject={puuid} />
          )}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Historique

const lpText = (lp: number) => `${lp > 0 ? "+" : lp < 0 ? "−" : ""}${Math.abs(lp)} LP`;
const QUEUES: ("all" | QueueKind)[] = ["all", "solo", "flex", "5c5"];

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 60) return t("il y a {max} min", { max: Math.max(1, min) });
  const h = Math.round(min / 60);
  if (h < 24) return t("il y a {h} h", { h: h });
  const d = Math.round(h / 24);
  return d === 1 ? t("hier") : t("il y a {d} j", { d: d });
}

interface HistoryProps {
  stats: Stats; games: Game[] | null; assets: Assets;
  role: number | null; onRole: (r: number | null) => void;
  me: string | null; subject?: string;
  title?: string; intro?: string | null; empty?: string | null; error?: string | null;
  footer?: React.ReactNode; notice?: React.ReactNode; showLp?: boolean;
  onOpenPlayer: (puuid: string | null) => void;
  /** Historique filtré sur un partenaire de duo. */
  duo?: DuoFilter | null; onClearDuo?: () => void;
  /** Partie à déplier à l’ouverture (depuis un bilan de l’onglet Progression). */
  focus?: number | null;
  /** File choisie dans la barre d'onglets (partagée avec Stats) : le filtre de file de l'historique est alors masqué. */
  queue?: "all" | QueueKind;
}

/** Historique : filtre par file et par poste (le poste choisit aussi les meilleurs picks), ligne dépliable. */
function History({ stats, games, assets, role, onRole, me, subject, title, intro, empty, error, notice, footer,
                   showLp = false, onOpenPlayer, duo, onClearDuo, focus = null, queue: shared }: HistoryProps) {
  const [own, setQueue] = useState<"all" | QueueKind>("all");
  const queue = shared ?? own;
  const [open, setOpen] = useState<number | null>(focus);
  useEffect(() => {
    if (focus == null) return;
    setOpen(focus);
    window.setTimeout(() => document.getElementById(`game-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, [focus]);
  const ratings = useRatings(stats, games, subject ?? me);
  const inQueue = useMemo(() => (games ?? []).filter((g) => queue === "all" ? g.queue !== "other" : g.queue === queue), [games, queue]);
  const shown = role == null ? inQueue : inQueue.filter((g) => g.role === role);
  const count = (q: "all" | QueueKind) => (games ?? []).filter((g) => q === "all" ? g.queue !== "other" : g.queue === q).length;

  return (
    <section className="history">
      <div>
        {title && <h2>{title}</h2>}
        {intro && <p className="muted small">{intro}</p>}
      </div>
      {duo && (
        <div className="duo-filter">
          <button className="duo-chip" onClick={onClearDuo} title={t("Revenir à tout l’historique")}>
            <ProfileIcon version={stats.ddragon} icon={duo.icon} size={1.125} />{t("Avec ")}{duo.name}<span aria-hidden>✕</span>
          </button>
          <span className={`small tone-${wrTone(duo.wins / Math.max(1, duo.games))}`}>
            {duo.wins} V – {duo.games - duo.wins} D · {pct(duo.wins / Math.max(1, duo.games))}<Trend tone={wrTone(duo.wins / Math.max(1, duo.games))} />
          </span>
        </div>
      )}
      {duo && !games && <div className="skeleton">{[0, 1, 2].map((i) => <span key={i} />)}</div>}
      {empty && <p className="hint">{empty}</p>}
      {error && <p className="hint">{error}</p>}
      {notice}
      {games && (
        <>
          {!shared && <div className="history__filters">
            <QueueFilter queue={queue} onQueue={setQueue} count={count} />
            <Segmented className="segmented" role="tablist" aria-label={t("Poste (meilleurs picks et historique)")}>
              {[null, 0, 1, 2, 3, 4].map((r) => (
                <button key={String(r)} role="tab" aria-selected={role === r} className={role === r ? "is-active" : ""}
                        onClick={() => onRole(r)}>
                  {r == null ? t("Tous") : ROLE_LABELS[r]}{" "}
                  <span className="count">{r == null ? inQueue.length : inQueue.filter((g) => g.role === r).length}</span>
                </button>
              ))}
            </Segmented>
          </div>}
          <div className="history__list stagger" key={`${queue}-${role}`}>
          {shown.map((g) => (
            <Fragment key={g.id}>
              {open === g.id ? (
                <div className="game-open" id={`game-${g.id}`}>
                  <GameRow stats={stats} game={g} assets={assets} open showLp={showLp} rating={ratings.get(g.id)}
                           partner={duo ? partnerText(stats, duo, g.id) : undefined} onToggle={() => setOpen(null)} />
                  <GameDetailPanel stats={stats} game={g} assets={assets} me={subject ?? me} onOpenPlayer={onOpenPlayer} />
                </div>
              ) : (
                <GameRow stats={stats} game={g} assets={assets} open={false} showLp={showLp} rating={ratings.get(g.id)}
                         partner={duo ? partnerText(stats, duo, g.id) : undefined} onToggle={() => setOpen(g.id)} />
              )}
            </Fragment>
          ))}
          {shown.length === 0 && <p className="hint">{t("Aucune partie pour ce filtre.")}</p>}
          </div>
          {footer}
        </>
      )}
    </section>
  );
}

/**
 * Note de chaque partie de la liste pour le joueur suivi, sans ouvrir le détail : le détail des 10 joueurs
 * est lu dans le client LoL, une partie après l'autre (les plus récentes d'abord, 40 au plus).
 * undefined = en cours, null = indisponible (remake, client fermé).
 */
function useRatings(stats: Stats, games: Game[] | null, subject: string | null): Map<number, Rating | null> {
  const guess = useGuess(stats);
  const [ratings, setRatings] = useState<Map<number, Rating | null>>(new Map());
  const ids = (games ?? []).slice(0, 40).map((g) => g.id).join(",");
  useEffect(() => {
    if (!games?.length) return;
    let alive = true;
    (async () => {
      for (const g of games.slice(0, 40)) {
        if (!alive) return;
        if (g.remake) { setRatings((m) => new Map(m).set(g.id, null)); continue; }
        try {
          const detail = await loadGameDetail(g.id, guess);
          const notes = rateGame(detail);
          const lines = detail.teams.flatMap((t) => t.players);
          const mine = lines.find((p) => subject != null && p.puuid === subject)
            ?? lines.find((p) => p.champ === g.champ && p.kills === g.kills && p.deaths === g.deaths && p.assists === g.assists);
          if (alive) setRatings((m) => new Map(m).set(g.id, mine ? notes.get(mine) ?? null : null));
        } catch {
          if (alive) setRatings((m) => new Map(m).set(g.id, null));
        }
      }
    })();
    return () => { alive = false; };
  }, [ids, subject, guess]); // eslint-disable-line react-hooks/exhaustive-deps
  return ratings;
}

/** Bottes à part, puis 5 objets (6 pour un ADC : la quête de rôle libère une place), puis la balise. */
function splitItems(items: number[], role: number | null, info: InfoMap | null) {
  const trinket = items[6] ?? 0;
  const quest = items[7] ?? 0;
  const bag = items.slice(0, 6).filter((i) => i > 0);
  let boots = quest > 0 ? quest : bag.find((i) => info?.get(i)?.boots) ?? 0;
  const main = [...bag];
  const k = boots && quest === 0 ? main.indexOf(boots) : -1;
  if (k >= 0) main.splice(k, 1);
  if (!boots && quest > 0) boots = quest;
  const slots = Math.max(role === 3 ? 6 : 5, main.length);
  while (main.length < slots) main.push(0);
  return { boots, main, trinket };
}

function ItemRow({ items, role, assets, size }: { items: number[]; role: number | null; assets: Assets; size: "md" | "sm" }) {
  const { boots, main, trinket } = splitItems(items, role, assets.items);
  return (
    <span className={`items items--${size}`}>
      <ItemIcon id={boots} info={assets.items} boots />
      <span className="items__gap" aria-hidden />
      {main.map((id, i) => <ItemIcon key={i} id={id} info={assets.items} />)}
      <ItemIcon id={trinket} info={assets.items} trinket />
    </span>
  );
}

function ItemIcon({ id, info, boots = false, trinket = false }: { id: number; info: InfoMap | null; boots?: boolean; trinket?: boolean }) {
  const it = id ? info?.get(id) : undefined;
  const cls = `item${boots ? " item--boots" : ""}${trinket ? " item--trinket" : ""}`;
  return (
    <span className={cls} title={it?.name ?? (id ? t("Objet {id}", { id: id }) : boots ? t("Bottes") : trinket ? t("Balise") : t("Vide"))}>
      {it && <img src={it.icon} alt="" draggable={false} />}
    </span>
  );
}

/** Sorts (D, F) et runes (rune clé, arbre secondaire). */
function Loadout({ spells, keystone, subStyle, assets, size }:
  { spells: number[]; keystone: number; subStyle: number; assets: Assets; size: "md" | "sm" }) {
  const sp = (id: number) => {
    const s = id ? assets.spells?.get(id) : undefined;
    return <span className="loadout__spell" title={s?.name ?? ""}>{s && <img src={s.icon} alt="" draggable={false} />}</span>;
  };
  return (
    <span className={`loadout loadout--${size}`}>
      <span className="loadout__col">{sp(spells[0] ?? 0)}{sp(spells[1] ?? 0)}</span>
      <span className="loadout__col">
        {keystone ? <Rune data={assets.runes} id={keystone} size="minor" /> : <span className="loadout__rune" />}
        {subStyle ? <Rune data={assets.runes} id={subStyle} size="shard" /> : <span className="loadout__rune" />}
      </span>
    </span>
  );
}

function GameRow({ stats, game: g, assets, open, showLp, rating, partner, onToggle }:
  { stats: Stats; game: Game; assets: Assets; open: boolean; showLp: boolean; rating: Rating | null | undefined;
    partner?: string; onToggle: () => void }) {
  const result = g.remake ? "remake" : g.win ? "win" : "loss";
  const kda = g.deaths ? (g.kills + g.assists) / g.deaths : g.kills + g.assists;
  const min = Math.round(g.duration / 60);
  return (
    <InButton.Provider value={true}>
    <button className={`game game--${result}${open ? " is-open" : ""}`} onClick={onToggle} aria-expanded={open}
            aria-label={[result === "remake" ? t("Remake") : g.win ? t("Victoire") : t("Défaite"), champName(stats, g.champ),
              `${g.kills} / ${g.deaths} / ${g.assists}`, t("{n} min", { n: min }), ago(g.created),
              ...(showLp && g.lp != null ? [lpText(g.lp)] : [])].join(" · ")}>
      <ChampionIcon stats={stats} champ={g.champ} size={2.5} />
      <Loadout spells={g.spells} keystone={g.keystone} subStyle={g.subStyle} assets={assets} size="md" />
      <span className="game__id">
        <span className="game__name">
          {champName(stats, g.champ)}
          {rating?.badge && (
            <span className={`badge-note badge-note--lg badge-note--${rating.badge.toLowerCase()}`}
                  title={rating.badge === "MVP" ? t("Meilleure note de l’équipe gagnante") : t("Meilleure note de l’équipe perdante")}>
              {rating.badge}
            </span>
          )}
        </span>
        <span className="muted small">
          {partner ?? `${g.queue === "other" ? g.queueName : QUEUE_LABELS[g.queue]}${g.role != null ? ` · ${ROLE_LABELS[g.role]}` : ""}`} · {ago(g.created)}
        </span>
      </span>
      <ItemRow items={g.items} role={g.role} assets={assets} size="md" />
      <span className="grow" />
      <span className="stat-col game__note">
        {rating && rating.parts.length > 0 && <NoteTip rating={rating} />}
        <span className="stat-col__value">
          <span className={`tone-${rating ? noteTone(rating.note) : "neutral"}`}>{rating ? noteText(rating.note) : "—"}</span>
          {rating && <Trend tone={noteTone(rating.note)} />}
          <small> /20</small>
        </span>
        <span className="stat-col__label">
          {rating ? t("{rank} sur 10", { rank: ordinal(rating.rank) })
            : rating === null ? (g.remake ? t("Remake") : t("Note")) : t("Calcul…")}
        </span>
      </span>
      <span className="game__sep" aria-hidden />
      <span className="stat-col game__kda">
        <span className="stat-col__value">{g.kills} / {g.deaths} / {g.assists}</span>
        <span className="stat-col__label">KDA {dec1(kda)} · {int(g.cs)} CS</span>
      </span>
      <span className="game__sep" aria-hidden />
      <span className="stat-col game__lp">
        {showLp && g.lp != null ? (
          <span className={`game__lp-value${g.lp > 0 ? " tone-good" : g.lp < 0 ? " tone-bad" : ""}`}>{lpText(g.lp)}</span>
        ) : (
          <span className={`game__lp-value tone-${result === "remake" ? "neutral" : g.win ? "good" : "bad"}`}>
            {result === "remake" ? t("Remake") : g.win ? t("Victoire") : t("Défaite")}
          </span>
        )}
        <span className="stat-col__label">{showLp && g.lp != null ? `${result === "remake" ? t("Remake") : g.win ? t("Victoire") : t("Défaite")} · ` : ""}{t("{n} min", { n: min })}</span>
      </span>
      <svg className="game__chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    </InButton.Provider>
  );
}

const perMin = (x: number, seconds: number) => (seconds > 60 ? x / (seconds / 60) : 0);
const kGold = (x: number) => `${dec1(x / 1000)} k`;

/** Détail d'une partie : les deux équipes, scores, CS, dégâts, or et objets de chaque joueur. */
function GameDetailPanel({ stats, game, assets, me, onOpenPlayer }:
  { stats: Stats; game: Game; assets: Assets; me: string | null; onOpenPlayer: (puuid: string | null) => void }) {
  const guess = useGuess(stats);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState(false);
  const [savedView, setView] = usePersistent<"general" | "runes" | "recap">("spec.gameDetailView", "general");
  const canRecap = me != null && !game.remake;
  const view = savedView === "recap" && !canRecap ? "general" : savedView;
  useEffect(() => {
    let alive = true;
    loadGameDetail(game.id, guess).then((d) => alive && setDetail(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [game.id, guess]);

  if (error) return <p className="game-detail__msg">{t("Le détail de cette partie passe par le client LoL : ouvre-le, puis réessaie.")}</p>;
  if (!detail) return <div className="skeleton" aria-label={t("Chargement du détail")}>{[0, 1, 2, 3, 4].map((i) => <span key={i} />)}</div>;
  const all = detail.teams.flatMap((t) => t.players);
  const maxDamage = Math.max(1, ...all.map((p) => p.damage));
  const notes = rateGame(detail);
  // ton équipe d'abord
  const teams = [...detail.teams].sort((a, b) => Number(b.players.some((p) => p.puuid === me)) - Number(a.players.some((p) => p.puuid === me)));
  return (
    <>
    <div className="gtabs" role="tablist" aria-label={t("Vue du détail")}>
      {(canRecap ? ["general", "runes", "recap"] as const : ["general", "runes"] as const).map((v) => (
        <button key={v} role="tab" aria-selected={view === v} className={view === v ? "is-active" : ""} onClick={() => setView(v)}>
          {v === "general" ? t("Général") : v === "runes" ? t("Runes") : t("Récap")}
        </button>
      ))}
    </div>
    {view === "recap" && me && <RecapView stats={stats} game={game} me={me} embedded />}
    {view !== "recap" && <div className="game-detail">
      {view === "runes" && <PlayedRunesView stats={stats} teams={teams} runes={assets.runes} me={me} />}
      {view === "general" && teams.map((team) => {
        const k = team.players.reduce((a, p) => a + p.kills, 0), d = team.players.reduce((a, p) => a + p.deaths, 0);
        const a = team.players.reduce((x, p) => x + p.assists, 0), gold = team.players.reduce((x, p) => x + p.gold, 0);
        return (
          <div key={team.teamId} className="game-detail__team">
            <div className="pline pline--head">
              <span className="pline__who pline__team">
                <strong className={`tone-${team.win ? "good" : "bad"}`}>{team.win ? t("Victoire") : t("Défaite")} · {team.teamId === 100 ? t("Équipe bleue") : t("Équipe rouge")}</strong>
                <small>{k} / {d} / {a} · {kGold(gold)} {t("or")}</small>
              </span>
              <span>{t("Note")}</span>
              <span>KDA</span>
              <span>CS</span>
              <span>{t("Dégâts")}</span>
              <span>{t("Or")}</span>
              <span>{t("Vision")}</span>
              <span>{t("Objets")}</span>
            </div>
            {team.players.map((p, i) => (
              <PlayerRow key={`${p.puuid ?? p.name}-${i}`} stats={stats} p={p} duration={detail.duration} assets={assets}
                         maxDamage={maxDamage} rating={notes.get(p) ?? null}
                         isMe={p.puuid != null && p.puuid === me} onOpen={() => onOpenPlayer(p.puuid)} />
            ))}
          </div>
        );
      })}
      {view === "general" && <p className="muted small">{t("Note sur 20 calculée par rapport aux 9 autres joueurs, avec un barème propre à chaque rôle. MVP : meilleure note de l’équipe gagnante · ACE : meilleure note de l’équipe perdante. Clique sur un joueur pour ouvrir son profil.")}
      </p>}
    </div>}
    </>
  );
}

/** Runes jouées par les 10 joueurs : champion, rune clé, arbre principal, secondaire et fragments (description au survol). */
function PlayedRunesView({ stats, teams, runes, me }:
  { stats: Stats; teams: GameDetail["teams"]; runes: RuneData | null; me: string | null }) {
  return (
    <div className="grunes">
      {teams.map((team) => (
        <div key={team.teamId} className="grunes__team">
          {team.players.map((p, i) => (
            <div key={`${p.puuid ?? p.name}-${i}`} className={`grunes__p${p.puuid != null && p.puuid === me ? " is-me" : ""}`}>
              <span className="grunes__champ" title={`${champName(stats, p.champ)} · ${p.name}`}>
                <ChampionIcon stats={stats} champ={p.champ} size={3.5} />
                {p.keystone > 0 && <Rune data={runes} id={p.keystone} size="key" />}
              </span>
              {p.runes ? (
                <>
                  <span className="grunes__row">{p.runes.primary.map((id, k) => <Rune key={k} data={runes} id={id} size="minor" />)}</span>
                  <span className="grunes__row">{p.runes.sub.map((id, k) => <Rune key={k} data={runes} id={id} size="minor" />)}</span>
                  <span className="grunes__row grunes__shards">{p.runes.shards.map((id, k) => <Rune key={k} data={runes} id={id} size="shard" />)}</span>
                </>
              ) : <small className="muted">{t("Runes non renvoyées par le client")}</small>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PlayerRow({ stats, p, duration, assets, maxDamage, rating, isMe, onOpen }:
  { stats: Stats; p: PlayerLine; duration: number; assets: Assets; maxDamage: number; rating: Rating | null; isMe: boolean; onOpen: () => void }) {
  const kda = p.deaths ? (p.kills + p.assists) / p.deaths : p.kills + p.assists;
  const one = dec1;
  return (
    <div className={`pline${isMe ? " is-me" : ""}`}>
      <span className="pline__who">
        <ChampionIcon stats={stats} champ={p.champ} size={1.75} />
        <Loadout spells={p.spells} keystone={p.keystone} subStyle={p.subStyle} assets={assets} size="sm" />
        {isMe || !p.puuid ? (
          <span className="pline__name" title={champName(stats, p.champ)}>{p.name}</span>
        ) : (
          <button className="pline__name pline__link" onClick={onOpen} title={t("Ouvrir le profil de {name}", { name: p.name })}
                  aria-label={t("Ouvrir le profil de {name}", { name: p.name })}>
            {p.name}<span aria-hidden> ↗</span>
          </button>
        )}
        {rating?.badge && <span className={`badge-note badge-note--${rating.badge.toLowerCase()}`}>{rating.badge}</span>}
      </span>
      <span className="pline__note">
        {rating ? <span className="note-pill"><strong className={`tone-${noteTone(rating.note)}`}>{noteText(rating.note)}</strong><small>/20</small><Trend tone={noteTone(rating.note)} /></span> : "—"}
        {rating && rating.parts.length > 0 && <NoteTip rating={rating} self={isMe} />}
      </span>
      <span className="pline__num"><strong>{p.kills} / {p.deaths} / {p.assists}</strong><small>KDA {one(kda)}</small></span>
      <span className="pline__num"><strong>{int(p.cs)}</strong><small>{t("{n} / min", { n: one(perMin(p.cs, duration)) })}</small></span>
      <span className="pline__dmg">
        <span className="pline__dmg-top">
          <strong>{int(p.damage)}</strong>
          <span className="gauge"><span style={{ width: `${Math.round((p.damage / maxDamage) * 100)}%` }} /></span>
        </span>
        <small>{t("{n} / min", { n: int(perMin(p.damage, duration)) })}</small>
      </span>
      <span className="pline__num"><strong>{kGold(p.gold)}</strong><small>{t("{n} / min", { n: int(perMin(p.gold, duration)) })}</small></span>
      <span className="pline__num">
        {p.vision != null ? <><strong>{int(p.vision)}</strong><small>{t("{n} / min", { n: one(perMin(p.vision, duration)) })}</small></> : <strong>—</strong>}
      </span>
      <ItemRow items={p.items} role={p.role} assets={assets} size="sm" />
    </div>
  );
}

function persoText(perso: PersonalState): string {
  switch (perso.kind) {
    case "off": return t("Stats perso indisponibles : serveur Spec non configuré.");
    case "no-account": return t("Lance le client LoL : ton compte sera détecté automatiquement.");
    case "loading": return t("Chargement de tes stats perso…");
    case "unregistered": return t("Stats perso pas encore activées.");
    case "error": return t("Serveur Spec injoignable pour l’instant.");
    case "ready": {
      const d = perso.data;
      const base = t("Stats perso activées · {int} partie{v} classée{v2} analysée{v3} cette saison", { int: int(d.matches), v: d.matches > 1 ? "s" : "", v2: d.matches > 1 ? "s" : "", v3: d.matches > 1 ? "s" : "" });
      return d.syncing ? t("{base} · synchro en cours, {int} en attente", { base: base, int: int(d.pending) }) : base;
    }
  }
}

/** Icône d'invocateur (Data Dragon), cercle vide si inconnue. */
function ProfileIcon({ version, icon, size = 3 }: { version: string; icon: number | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: `${size}rem`, height: `${size}rem` };
  if (icon == null || failed) return <span className="icon icon--empty" style={box} aria-hidden />;
  return (
    <span className="icon icon--image account__icon" style={box}>
      <img src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${icon}.png`} alt={t("Icône d’invocateur")}
           draggable={false} onError={() => setFailed(true)} />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Onglets, filtre de rôle, impact de Spec, duo

type Tab = "history" | "stats" | "progress" | "duo";
const TAB_LABELS: Record<Tab, string> = { history: t("Historique"), stats: t("Stats"), progress: t("Progression"), duo: t("Duo") };

function ProfileTabs({ tab, onTab, tabs, extra }: { tab: Tab; onTab: (t: Tab) => void; tabs: Tab[]; extra?: React.ReactNode }) {
  return (
    <div className="ptabs-bar">
      <div className="ptabs" role="tablist" aria-label={t("Sections du profil")}>
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => onTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {extra && <div className="ptabs-bar__extra">{extra}</div>}
    </div>
  );
}

/** Filtre de file (Toutes, Solo/Duo, Flex, 5c5) : menu déroulant avec le nombre de parties de chaque file. */
function QueueFilter({ queue, onQueue, count }: { queue: "all" | QueueKind; onQueue: (q: "all" | QueueKind) => void; count?: (q: "all" | QueueKind) => number }) {
  return (
    <Select label={t("File")} value={queue} onChange={(v) => onQueue(v as "all" | QueueKind)}
            options={QUEUES.map((q) => [q, `${q === "all" ? t("Toutes les files") : QUEUE_LABELS[q]}${count ? ` · ${count(q)}` : ""}`])} />
  );
}

/** Filtre de rôle (historique et stats), avec le nombre de parties par rôle. */
function RoleFilter({ role, onRole, games }: { role: number | null; onRole: (r: number | null) => void; games: Game[] }) {
  const n = (r: number | null) => (r == null ? games.length : games.filter((g) => g.role === r).length);
  return (
    <Select label={t("Rôle")} value={role == null ? "all" : String(role)} onChange={(v) => onRole(v === "all" ? null : Number(v))}
            options={[["all", `${t("Tous les rôles")} · ${n(null)}`], ...[0, 1, 2, 3, 4].map((r) => [String(r), `${ROLE_LABELS[r]} · ${n(r)}`] as [string, string])]} />
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <span className="pselect">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

/** « Spec t'aide-t-il à gagner ? » : progression jusqu'à 20 parties, puis tendance, puis résultat fiable. */
function ImpactCard({ version }: { version: number }) {
  const data = useMemo(() => impact(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fg, fw] = data.followed, [og, ow] = data.other;
  const reliable = data.total >= IMPACT_RELIABLE;
  return (
    <section className="best">
      <div>
        <h2>{t("Spec t’aide-t-il à gagner ?")}</h2>
      </div>
      <div className="card impact">
        {data.total < IMPACT_MIN ? (
          <>
            <div className="impact__head">
              <strong>{t("{n} / {total} parties enregistrées", { n: data.total, total: IMPACT_MIN })}</strong>
              <span className="grow" />
              <span className="muted small">{plural(IMPACT_MIN - data.total, "Encore {n} partie", "Encore {n} parties")}</span>
            </div>
            <div className="impact__progress"><span style={{ width: `${(data.total / IMPACT_MIN) * 100}%` }} /></div>
            <p className="muted small">{t("Spec note le pick qu’il te conseillait à chaque partie jouée avec l’appli ouverte. Le résultat s’affiche après {n} parties.", { n: IMPACT_MIN })}</p>
          </>
        ) : (
          <>
            <div className="impact__head">
              <strong>{t("{n} parties enregistrées", { n: data.total })}</strong>
              <span className={`badge ${reliable ? "badge--mine" : ""}`}>{reliable ? t("Résultat fiable") : t("Tendance")}</span>
              <span className="grow" />
              {!reliable && <span className="muted small">{t("Résultat fiable à partir de {n} parties", { n: IMPACT_RELIABLE })}</span>}
            </div>
            <div className="impact__cols">
              <ImpactStat label={t("Tu joues le n°1 de Spec")} games={fg} wins={fw} />
              <ImpactStat label={t("Tu joues autre chose")} games={og} wins={ow} />
              {fg > 0 && og > 0 && (() => {
                const d = fw / fg - ow / og;
                return (
                  <div className="impact__diff">
                    <strong className={`tone-${d > 0.005 ? "good" : d < -0.005 ? "bad" : "neutral"}`}>
                      {d >= 0 ? "+" : "−"}{t("{n} pts", { n: dec1(Math.abs(d * 100)) })}
                    </strong>
                    <span className="muted small">{t("en suivant Spec")}</span>
                  </div>
                );
              })()}
            </div>
            {!reliable && <p className="muted small">{t("Tendance : sur si peu de parties, l’écart peut encore venir du hasard. Continue de jouer avec Spec ouvert pour l’affiner.")}</p>}
          </>
        )}
      </div>
    </section>
  );
}

function ImpactStat({ label, games, wins }: { label: string; games: number; wins: number }) {
  const wr = games ? wins / games : 0;
  const tone = games ? wrTone(wr) : "neutral";
  return (
    <div className="impact__stat">
      <span className="small">{label}</span>
      <strong className={`tone-${tone}`}>{games ? pct(wr) : "—"}<Trend tone={tone} /></strong>
      <span className="impact__bar"><span className={`tone-bg-${tone}`} style={{ width: `${wr * 100}%` }} /></span>
      <span className="muted small">{plural(games, "{n} partie", "{n} parties")} · {plural(wins, "{n} victoire", "{n} victoires")}</span>
    </div>
  );
}

interface DuoFilter { key: string; name: string; icon: number | null; games: number; wins: number; partner: Map<number, number> }

function partnerText(stats: Stats, duo: DuoFilter, gameId: number): string {
  const champ = duo.partner.get(gameId);
  const first = duo.name.split("#")[0];
  return champ != null ? t("Avec {first} ({champName})", { first: first, champName: champName(stats, champ) }) : t("Avec {first}", { first: first });
}

/** Duo : joueurs avec qui tu as joué en Solo/Duo (comptes liés à Spec), winrate ensemble et meilleur combo. */
function DuoList({ stats, client, selected, onOpen }:
  { stats: Stats; client: string; selected: string | null; onOpen: (f: DuoFilter) => void }) {
  const [duos, setDuos] = useState<Duo[] | null>(null);
  const [error, setError] = useState(false);
  const [names, setNames] = useState<Map<string, { name: string; icon: number | null } | null>>(new Map());
  useEffect(() => {
    let alive = true;
    loadDuos(client).then((d) => alive && setDuos(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [client]);
  useEffect(() => {
    if (!duos) return;
    let alive = true;
    (async () => {
      for (const d of duos) {
        const p = await duoPartner(d, client);
        if (alive) setNames((m) => new Map(m).set(d.key, p));
      }
    })();
    return () => { alive = false; };
  }, [duos, client]);

  if (error) return <p className="hint">{t("Le serveur Spec ne répond pas pour l’instant. Réessaie dans un instant.")}</p>;
  if (!duos) return <div className="skeleton">{[0, 1, 2].map((i) => <span key={i} />)}</div>;
  return (
    <section className="best">
      {duos.length === 0 ? (
        <p className="hint">{t("Aucune partie en duo avec un joueur Spec pour l’instant.")}</p>
      ) : (
        <div className="card duo-list stagger">
          <div className="duo-row duo-row--head"><span>{t("Joueur")}</span><span>{t("Winrate ensemble")}</span><span className="duo-row__combo">{t("Meilleur combo")}</span><span /></div>
          {duos.map((d) => {
            const who = names.get(d.key);
            const name = who?.name ?? (names.has(d.key) ? t("Joueur Spec") : "…");
            const wr = d.wins / d.games, tone = wrTone(wr);
            const best = [...d.combos].sort((a, b) => (b[3] / b[2] - a[3] / a[2]) || b[2] - a[2]).find((c) => c[2] >= 3) ?? d.combos[0];
            return (
              <button key={d.key} className={`duo-row${selected === d.key ? " is-selected" : ""}`}
                      onClick={() => onOpen({ key: d.key, name, icon: who?.icon ?? null, games: d.games, wins: d.wins,
                                              partner: new Map(d.matches.map(([m, pc]) => [Number(m.split("_")[1] ?? 0), pc])) })}>
                <span className="duo-row__who">
                  <ProfileIcon version={stats.ddragon} icon={who?.icon ?? null} size={2.5} />
                  <span><strong>{name}</strong><small>{plural(d.games, "{n} partie ensemble", "{n} parties ensemble")}</small></span>
                </span>
                <strong className={`duo-row__wr tone-${tone}`}>{pct(wr)}<Trend tone={tone} /></strong>
                <span className="duo-row__combo">
                  {best && <>
                    <ChampionIcon stats={stats} champ={best[0]} size={2} /><span className="muted">+</span>
                    <ChampionIcon stats={stats} champ={best[1]} size={2} />
                    <span><strong>{champName(stats, best[0])} + {champName(stats, best[1])}</strong>
                      <small>{pct(best[3] / best[2])} · {plural(best[2], "{n} partie", "{n} parties")}</small></span>
                  </>}
                </span>
                <span className="duo-row__go" aria-hidden>{selected === d.key ? "✓" : "›"}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Progression : courbe des LP, bilan après chaque partie

const shortDate = (t: number) => new Date(t).toLocaleDateString(locale(), { day: "numeric", month: "short" });

function ProgressView({ stats, games, queue, tier, version, onOpenGame }:
  { stats: Stats; games: Game[] | null; perso?: PersonalState; queue: LpQueue; tier?: string | null; version: number; onOpenGame: (id: number) => void }) {
  const series = useMemo(() => readLpSeries(queue), [version, queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => recaps(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const month = list.filter((r) => Date.now() - r.at < 30 * 86400_000);
  const followed = month.filter((r) => r.rank === 1).length;

  return (
    <>
      <LpChart stats={stats} series={series} games={byId} tier={tier ?? null} />

      {list.length > 0 && <section className="best">
        <div className="section-head">
          <div>
            <h2>{t("Après chaque partie")}</h2>
          </div>
          {month.length > 0 && <span className="muted small">{t("Ce mois-ci : conseil suivi {n} fois sur {total}", { n: followed, total: month.length })}</span>}
        </div>
        <div className="recaps stagger">
          {list.slice(0, 15).map((r) => <RecapRow key={r.game} stats={stats} recap={r} game={byId.get(r.game)} onOpen={() => onOpenGame(r.game)} />)}
        </div>
      </section>}
    </>
  );
}

type Period = "7" | "30" | "all";
const TIER_KEYS = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond"];
const APEX = TIER_KEYS.length * 400;
const tierIndex = (lp: number) => Math.min(TIER_KEYS.length, Math.floor(lp / 400));   // 7 = Maître et plus
const CREST_URL = "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests";
const tierColorOf = (lp: number) => TIER_COLOR[lp >= APEX ? "master" : TIER_KEYS[Math.max(0, tierIndex(lp))]];


/** Évolution des LP : bandes aux couleurs des rangs, un point par partie (vert gagné, rouge perdu), détail au survol. */
const APEX_NAME: Record<string, string> = { master: t("Maître"), grandmaster: t("Grand Maître"), challenger: t("Challenger") };

function LpChart({ stats, series, games, tier }: { stats: Stats; series: LpPoint[]; games: Map<number, Game>; tier: string | null }) {
  // au-delà de Diamant I, les LP ne disent pas le palier : on reprend celui du compte (Maître par défaut)
  const apexName = (tier && APEX_NAME[tier]) || t("Maître");
  const tierNameOf = (lp: number) => (lp >= APEX ? apexName : lpLabel(lp, true).replace(/ (IV|III|II|I)$/, ""));
  const fullLabel = (lp: number) => (lp >= APEX ? `${apexName} · ${lp - APEX} LP` : lpLabel(lp));
  const [period, setPeriod] = useState<Period>("30");
  const [hover, setHover] = useState<number | null>(null);
  const cut = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const older = series.filter((p) => p.at < cut), before = older[older.length - 1];
  const pts = [...(before ? [before] : []), ...series.filter((p) => p.at >= cut)].slice(-120);
  const head = (
    <div className="lp2__head">
      <h2>{t("Évolution de tes LP")}</h2>
      <Segmented className="segmented segmented--small" role="tablist" aria-label={t("Période")}>
        {([["7", t("7 jours")], ["30", t("30 jours")], ["all", t("Saison")]] as [Period, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={period === k} className={period === k ? "is-active" : ""} onClick={() => { setPeriod(k); setHover(null); }}>{l}</button>
        ))}
      </Segmented>
    </div>
  );
  if (pts.length < 2) {
    return (
      <section className="card lp2">
        {head}
        <p className="hint">{series.length < 2
          ? t("La courbe démarre avec tes prochaines parties classées jouées avec Spec ouvert : le client LoL ne garde pas l’historique de tes LP.")
          : t("Pas assez de parties suivies sur cette période.")}</p>
      </section>
    );
  }
  const first = pts[0], last = pts[pts.length - 1];
  const deltas = pts.map((p, i) => (i ? p.lp - pts[i - 1].lp : 0));
  const wins = deltas.filter((d) => d > 0).length, losses = deltas.filter((d) => d < 0).length;
  const peakI = pts.reduce((bi, p, i) => (p.lp > pts[bi].lp ? i : bi), 0);
  const lastSign = Math.sign(deltas[deltas.length - 1]);
  let streak = 0;
  for (let i = deltas.length - 1; i > 0 && lastSign !== 0 && Math.sign(deltas[i]) === lastSign; i--) streak++;
  const gain = last.lp - first.lp;

  // échelle : divisions de 100 LP (rangs de 400 si l'écart est grand)
  const vmin = Math.min(...pts.map((p) => p.lp)), vmax = Math.max(...pts.map((p) => p.lp));
  const step = vmax - vmin > 700 ? 400 : 100;
  let lo = Math.floor(vmin / step) * step, hi = Math.ceil((vmax + 1) / step) * step;
  if (hi - lo < 2 * step) { lo = Math.max(0, lo - step); hi = lo + 2 * step; }
  const W = 900, H = 260, L = 44, R = 8, T = 24, B = H - 24;
  const x = (i: number) => L + 6 + ((W - L - R - 12) * i) / (pts.length - 1);
  const y = (v: number) => T + (B - T) * (1 - (v - lo) / (hi - lo));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.lp).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${B} L${x(0).toFixed(1)} ${B} Z`;
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (pts.length - 1))))];
  const h = hover != null ? pts[hover] : null, hg = h?.game != null ? games.get(h.game) : undefined, hd = hover != null ? deltas[hover] : 0;
  const tone = gain > 0 ? "good" : gain < 0 ? "bad" : "neutral";
  const crestKey = (lp: number) => (lp >= APEX ? (tier && APEX_NAME[tier] ? tier : "master") : TIER_KEYS[Math.max(0, tierIndex(lp))]);
  const crest = (lp: number, cls: string) => <img className={cls} alt="" src={`${CREST_URL}/${crestKey(lp)}.svg`} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />;
  // la courbe prend la couleur du rang : dégradé vertical à paliers nets aux changements de rang
  const tierStops: { off: number; color: string }[] = [];
  // du rang le plus haut au plus bas : à offset égal, la couleur du rang du dessus passe avant (le tri garde l'ordre)
  for (let v = Math.floor((hi - 1) / 400) * 400; v >= Math.floor(lo / 400) * 400; v -= 400) {
    const a = Math.max(lo, v), b = Math.min(hi, v + 400);
    const o1 = (y(b) - T) / (B - T), o2 = (y(a) - T) / (B - T), col = tierColorOf(v);
    tierStops.push({ off: Math.max(0, o1), color: col }, { off: Math.min(1, o2), color: col });
  }
  tierStops.sort((p, q) => p.off - q.off);
  const tierLines: number[] = [], divLines: number[] = [];
  for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += 100) (v % 400 === 0 && v <= APEX ? tierLines : step === 100 ? divLines : []).push(v);
  return (
    <section className="card lp2">
      {head}
      <div className="lp2__plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Courbe des LP : de {a} à {b}", { a: fullLabel(first.lp), b: fullLabel(last.lp) })}>
          <defs>
            <linearGradient id="lp2-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.07" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lp2-tiers" gradientUnits="userSpaceOnUse" x1="0" y1={T} x2="0" y2={B}>
              {tierStops.map((st, i) => <stop key={i} offset={st.off} stopColor={st.color} />)}
            </linearGradient>
          </defs>
          {divLines.map((v) => <line key={`d${v}`} x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="lp2__grid" />)}
          {tierLines.map((v) => (
            <g key={`t${v}`}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="lp2__tier-line" />
              <text x={L + 6} y={y(v) + 14} className="lp2__band">{tierNameOf(v)}</text>
            </g>
          ))}
          <path d={area} fill="url(#lp2-fill)" />
          <path d={line} className="lp2__line" stroke="url(#lp2-tiers)" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T - 10} y2={B} className="lp2__cursor" />}
          <circle cx={x(pts.length - 1)} cy={y(last.lp)} r={5} fill={tierColorOf(last.lp)} className="lp2__dot" />
          {hover != null && h && <circle cx={x(hover)} cy={y(h.lp)} r={7} fill={tierColorOf(h.lp)} className="lp2__dot lp2__dot--hover" />}
          {pts.map((_, i) => (
            <rect key={`h${i}`} x={x(i) - Math.max(4, (W - L) / pts.length / 2)} y={T - 10} width={Math.max(8, (W - L) / pts.length)} height={B - T + 10} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
          {ticks.map((i) => (
            <text key={`x${i}`} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="lp2__date">
              {i === pts.length - 1 ? t("Maintenant") : shortDate(pts[i].at)}</text>
          ))}
        </svg>
        {/* emblèmes de rang sur l'axe, à chaque changement de rang */}
        {tierLines.map((v) => (
          <span key={`c${v}`} className="lp2__crest" style={{ top: `${(y(v) / H) * 100}%` }}>{crest(v, "")}</span>
        ))}
        {h && hover != null && (
          <div className={`lp2__tip${x(hover) > W * 0.62 ? " is-left" : ""}`} style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.lp) / H) * 100}%` }}>
            {crest(h.lp, "lp2__tip-crest")}
            <span>
              <strong style={{ color: tierColorOf(h.lp) }}>{fullLabel(h.lp)}</strong>
              <small>{[shortDate(h.at), hg ? `${champName(stats, hg.champ)} · ${hg.win ? t("Victoire") : t("Défaite")}` : null, hover ? lpText(hd) : null].filter(Boolean).join(" · ")}</small>
            </span>
          </div>
        )}
      </div>
      <div className="lp2__strip">
        <div><small>{t("Bilan")}</small><strong className={`tone-${tone}`}>{lpText(gain)}</strong></div>
        <div><small>{t("Pic")}</small>{crest(pts[peakI].lp, "lp2__strip-crest")}<strong style={{ color: tierColorOf(pts[peakI].lp) }}>{fullLabel(pts[peakI].lp)}</strong></div>
        <div><small>{t("Parties")}</small><strong>{t("{w} V – {l} D", { w: wins, l: losses })}</strong></div>
        <div><small>{t("Série")}</small>
          <strong className={streak ? `tone-${lastSign > 0 ? "good" : "bad"}` : ""}>
            {streak ? plural(streak, lastSign > 0 ? "{n} victoire" : "{n} défaite", lastSign > 0 ? "{n} victoires" : "{n} défaites") : "—"}</strong></div>
      </div>
    </section>
  );
}

function RecapRow({ stats, recap: r, game, onOpen }: { stats: Stats; recap: Recap; game: Game | undefined; onOpen: () => void }) {
  const verdict = r.rank === 1 ? [t("Conseil suivi"), "good"] : r.rank != null && r.rank <= 3 ? [t("Dans le top 3"), "good"] : [t("Autre choix"), "neutral"];
  const result = game?.remake ? t("Remake") : r.win ? t("Victoire") : t("Défaite");
  return (
    <button className={`recap recap--${game?.remake ? "remake" : r.win ? "win" : "loss"}`} onClick={onOpen} disabled={!game}
            title={game ? t("Ouvrir le détail de la partie") : t("Partie plus chargée dans l’historique")}>
      <span className="recap__played">
        <ChampionIcon stats={stats} champ={r.champ} size={2.5} />
        <span>
          <strong>{champName(stats, r.champ)}</strong>
          <small>{game?.role != null ? `${ROLE_LABELS[game.role]} · ` : ""}{ago(game?.created ?? r.at)}</small>
        </span>
      </span>
      <span className="recap__spec">
        <small className="recap__label">{t("Spec conseillait")}</small>
        <span className="recap__picks">
          {r.top.map((c, i) => (
            <span key={c} className={`recap__pick${c === r.champ ? " is-played" : ""}`}>
              <ChampionIcon stats={stats} champ={c} size={1.375} />{i + 1}. {champName(stats, c)}
            </span>
          ))}
        </span>
      </span>
      <span className={`recap__verdict recap__verdict--${verdict[1]}`}>{verdict[0]}</span>
      <span className="stat-col recap__result">
        <span className={`game__lp-value${game?.lp == null ? "" : game.lp > 0 ? " tone-good" : game.lp < 0 ? " tone-bad" : ""}`}>
          {game?.lp == null ? result : lpText(game.lp)}
        </span>
        <span className="stat-col__label">{game?.lp == null ? `${Math.round((game?.duration ?? 0) / 60) || "—"} min` : result}</span>
      </span>
    </button>
  );
}

// --- Explication de la note (0.4.0) ---
const signed = (x: number) => `${x > 0.04 ? "+" : x < -0.04 ? "−" : ""}${dec1(Math.abs(x))}`;
function partLabel(c: Contribution): string {
  const labels: Record<Criterion, string> = {
    kp: t("Participation"), dmg: t("Dégâts"), gold: t("Or"), cs: t("Farm"), deaths: t("Morts"), vision: t("Vision"),
    result: c.points >= 0 ? t("Victoire") : t("Défaite"),
  };
  return labels[c.key];
}
/** Groupe nominal pour la phrase d'explication ; `good` = le critère a fait monter la note. */
function partPhrase(c: Contribution, good: boolean): { text: string; plural: boolean } {
  switch (c.key) {
    case "kp": return { text: t("ta participation aux kills"), plural: false };
    case "dmg": return { text: t("tes dégâts"), plural: true };
    case "gold": return { text: t("ton or"), plural: false };
    case "cs": return { text: t("ton farm"), plural: false };
    case "vision": return { text: t("ta vision"), plural: false };
    case "deaths": return good ? { text: t("le peu de morts"), plural: false } : { text: t("tes morts"), plural: true };
    default: return { text: "", plural: false };
  }
}
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** Au survol d'une note : la part de chaque critère (barres), et pour ta note une phrase de résumé.
 *  Rendu dans document.body (position fixe) pour passer au-dessus de tout, sans être coupé par un conteneur. */
function NoteTip({ rating, self = true }: { rating: Rating; self?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host) return;
    let timer = 0;
    const show = () => {
      timer = window.setTimeout(() => {
        const r = host.getBoundingClientRect();
        const below = r.top < 300; // pas la place au-dessus : on ouvre en dessous
        setPos({ x: Math.min(Math.max(r.left + r.width / 2, 190), window.innerWidth - 190), y: below ? r.bottom + 8 : r.top - 8, below });
      }, 120);
    };
    const hide = () => { window.clearTimeout(timer); setPos(null); };
    host.addEventListener("mouseenter", show); host.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", hide, true);
    return () => { hide(); host.removeEventListener("mouseenter", show); host.removeEventListener("mouseleave", hide); window.removeEventListener("scroll", hide, true); };
  }, []);
  const { up, down } = summaryParts(rating);
  const ups = up.map((c) => ({ ...partPhrase(c, true), pts: signed(c.points) }));
  let line1: string | null = null;
  if (ups.length === 2) line1 = t("{a} ({pa}) et {b} ({pb}) t’ont fait monter.", { a: cap(ups[0].text), pa: ups[0].pts, b: ups[1].text, pb: ups[1].pts });
  else if (ups.length === 1) line1 = ups[0].plural ? t("{a} ({pa}) t’ont fait monter.", { a: cap(ups[0].text), pa: ups[0].pts }) : t("{a} ({pa}) t’a fait monter.", { a: cap(ups[0].text), pa: ups[0].pts });
  let line2: string | null = null;
  if (down) { const d = partPhrase(down, false); line2 = d.plural ? t("{a} ({pa}) t’ont coûté le plus.", { a: cap(d.text), pa: signed(down.points) }) : t("{a} ({pa}) t’a coûté le plus.", { a: cap(d.text), pa: signed(down.points) }); }
  return (
    <span ref={anchor} hidden>
      {pos && createPortal(
        <div className={`note-tip${pos.below ? " note-tip--below" : ""}`} role="tooltip" style={{ left: pos.x, top: pos.y }}>
          {self && (line1 || line2) && (
            <span className="note-tip__summary">
              {line1 && <span>{line1}</span>}
              {line2 && <span>{line2}</span>}
            </span>
          )}
          <RatingBreakdown rating={rating} />
        </div>, document.body)}
    </span>
  );
}

const BAR_MAX = 2.2;   // points pour une demi-barre pleine
function RatingBreakdown({ rating }: { rating: Rating }) {
  return (
    <span className="rating-why" aria-label={t("Détail de la note")}>
      {sortedParts(rating).map((c) => {
        const w = `${Math.min(100, (Math.abs(c.points) / BAR_MAX) * 100)}%`;
        const tone = c.points > 0.04 ? "good" : c.points < -0.04 ? "bad" : "neutral";
        return (
          <span key={c.key} className="rating-why__row">
            <span className="rating-why__label">{partLabel(c)}</span>
            <span className="rating-why__bar" aria-hidden>
              <span className="rating-why__half rating-why__half--neg">{c.points < -0.04 && <span className="rating-why__fill tone-bg-bad" style={{ width: w }} />}</span>
              <span className="rating-why__zero" />
              <span className="rating-why__half">{c.points > 0.04 && <span className="rating-why__fill tone-bg-good" style={{ width: w }} />}</span>
            </span>
            <span className={`rating-why__pts tone-${tone}`}>{signed(c.points)}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Rang Solo/Duo avec l'emblème Riot (Community Dragon) ; le texte seul si l'image ne charge pas. */
function RankLine({ tier, rank }: { tier: string | null; rank: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <p className="account__rank rank-line">
      {tier && !failed && (
        <img src={`https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier}.svg`}
             alt="" aria-hidden draggable={false} onError={() => setFailed(true)} />
      )}
      {rank}
    </p>
  );
}
