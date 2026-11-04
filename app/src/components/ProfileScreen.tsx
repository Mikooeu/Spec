import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, type Stats } from "../lib/score";
import { champName, dec1, int, pct, wrTone } from "../lib/ui";
import type { PersonalState, Personal } from "../lib/api";
import type { Account } from "../lib/lcu";
import { ChampionIcon } from "./ChampionIcon";
import { Rune, useRuneData, type RuneData } from "./Runes";
import { loadItems, loadSpells, useInfo, type InfoMap } from "../lib/ddragon";
import { IMPACT_MIN, IMPACT_RELIABLE, impact, recaps, settle, type Recap } from "../lib/impact";
import { Trend } from "./Trend";
import {
  QUEUE_LABELS, duoPartner, loadDuos, type Duo, findPlayer, loadGameDetail, loadHistory, loadPlayer, loadServerHistory, mergeHistory, rankText,
  readRanked, readLpSeries, noteSoloLp, lpLabel, type LpPoint, type Game, type GameDetail, type OtherPlayer, type PlayerLine, type QueueKind,
} from "../lib/history";
import { noteText, noteTone, rateGame, type Rating } from "../lib/rating";
import { Segmented } from "./Segmented";
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

type Guess = (champ: number, notJungle: boolean) => number | null;

/** Poste probable d'après les parties Master+, quand le client ne le donne pas. */
function useGuess(stats: Stats): Guess {
  return useCallback((champ: number, notJungle: boolean) => {
    const dist = stats.roleGames.get(champ);
    if (!dist) return null;
    let best: number | null = null;
    dist.forEach((g, r) => { if ((!notJungle || r !== 1) && g > 0 && (best == null || g > dist[best])) best = r; });
    return best;
  }, [stats]);
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
      <PlayerSearch region={account?.region ?? null} clientOn={clientOn} onFound={open} />
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
  const [historyError, setHistoryError] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("history");   // le profil s'ouvre toujours sur l'historique
  const [duo, setDuo] = useState<DuoFilter | null>(null);
  const [duoGames, setDuoGames] = useState<Game[] | null>(null);
  const [impactVersion, setImpactVersion] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);   // partie à déplier en ouvrant l’historique
  const registered = perso.kind === "ready";

  useEffect(() => {
    if (!clientOn) return;
    let alive = true;
    loadHistory(50, guess).then((g) => { if (alive) { setClientGames(g); setHistoryError(false); } })
      .catch(() => alive && setHistoryError(true));
    readRanked().then((r) => { noteSoloLp(r); if (alive) setRank(rankText(r?.queueMap?.RANKED_SOLO_5x5)); });
    return () => { alive = false; };
  }, [clientOn, lpVersion, guess]);

  // historique complet de la saison (Solo/Duo) gardé par le serveur Spec
  useEffect(() => {
    if (!registered || !account?.puuid) return;
    let alive = true;
    loadServerHistory(account.puuid).then((g) => {
      if (!alive) return;
      setServerGames(g);
      setMore(g.length < 20 ? "end" : "idle");
    }).catch(() => undefined);
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
      <header className="page-head">
        <div>
          <p className="overline">{t("Profil")}</p>
          <h1>{t("Ton profil")}</h1>
        </div>
      </header>

      <div className="card account">
        <ProfileIcon version={stats.ddragon} icon={account?.icon ?? null} />
        <div className="grow">
          <p className="account__name">{account ? `${account.name}${account.region ? ` · ${account.region}` : ""}` : t("Aucun compte lié")}</p>
          {rank && <p className="account__rank">{t("Classé Solo/Duo · ")}{rank}</p>}
          <p className="muted small">{persoText(perso)}</p>
        </div>
        <span className="pill">
          <span className={clientOn ? "dot" : "dot dot--off"} />{clientOn ? t("Client LoL connecté") : t("Client LoL fermé")}
        </span>
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

      {perso.kind === "ready" && <SeasonTiles stats={stats} data={perso.data} games={games} />}

      <ProfileTabs tab={tab} onTab={setTab} tabs={registered ? ["history", "stats", "progress", "duo"] : ["history", "stats", "progress"]} />

      <div key={tab} className="profile-view fade-in">
      {tab === "history" && (
        <History stats={stats} games={duo ? duoGames : games} assets={assets} role={role} onRole={setRole} me={account?.puuid ?? null}
                 intro={duo ? t("Vos {games} parties ensemble en Solo/Duo, de la plus récente à la plus ancienne.", { games: duo.games })
                   : registered
                   ? t("Tes parties de la saison. Clique sur une partie pour voir le détail des 10 joueurs. Les LP s’affichent pour les parties jouées avec Spec ouvert.")
                   : t("Tes dernières parties. Clique sur une partie pour voir le détail des 10 joueurs. Active tes stats perso pour retrouver toute ta saison.")}
                 empty={!clientOn && !games ? t("Lance le client LoL pour voir ton historique.") : null}
                 error={historyError && !serverGames.length ? t("Le client LoL n’a pas renvoyé ton historique. Réessaie dans un instant.") : null}
                 onOpenPlayer={onOpenPlayer} showLp duo={duo} onClearDuo={() => setDuo(null)} focus={focus}
                 footer={!duo && registered && serverGames.length > 0 && more !== "end" ? (
                   <button className="btn btn--secondary btn--small history__more" onClick={loadMore} disabled={more === "loading"}>
                     {more === "loading" ? t("Chargement…") : t("Afficher plus de parties")}
                   </button>
                 ) : null} />
      )}
      {tab === "stats" && (
        <>
          <ImpactCard version={impactVersion} />
          {perso.kind === "ready"
            ? <OwnBestPicks stats={stats} data={perso.data} />
            : <p className="hint">{t("Active tes stats perso pour voir tes meilleurs picks de la saison.")}</p>}
        </>
      )}
      {tab === "progress" && (
        <ProgressView stats={stats} games={games} perso={perso} version={lpVersion + impactVersion} onOpenGame={openGame} />
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
    <div className="tiles">
      <Tile label={t("Winrate saison")} value={pct(wins / games)} detail={t("{int} parties classées", { int: int(games) })} />
      <Tile label={t("Champion le plus joué")} stats={stats} champ={top?.[0]}
            value={top ? champName(stats, top[0]) : "—"}
            detail={top ? t("{pct} · {n} parties", { pct: pct(top[1][1] / top[1][0]), n: int(top[1][0]) }) : ""} />
      {week.length
        ? <Tile label={t("LP cette semaine")} value={lpText(total)} tone={total > 0 ? "good" : total < 0 ? "bad" : "neutral"}
                detail={t("{length} partie{v} suivie{v2} par Spec", { length: week.length, v: week.length > 1 ? "s" : "", v2: week.length > 1 ? "s" : "" })} />
        : <Tile label={t("Rôle principal")} value={ROLE_LABELS[mainRole]} detail={t("{pct} de tes parties", { pct: pct(byRole[mainRole] / games) })} />}
    </div>
  );
}

function Tile({ label, value, detail, tone, stats, champ }:
  { label: string; value: string; detail: string; tone?: string; stats?: Stats; champ?: number }) {
  return (
    <div className="tile-stat">
      <span className="tile-stat__label">{label}</span>
      <span className={`tile-stat__value${champ != null ? " tile-stat__value--champ" : ""}${tone ? ` tone-${tone}` : ""}`}>
        {stats && champ != null && <ChampionIcon stats={stats} champ={champ} size={1.75} />}
        {value}{tone && <Trend tone={tone} />}
      </span>
      <span className="tile-stat__detail">{detail}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Meilleurs picks

interface Pick { champ: number; games: number; wins: number; share: number }

/** Les 3 meilleurs winrates parmi les champions assez joués (dans le rôle choisi, ou tous rôles). */
function bestPicks(rows: [number, number, number, number][], role: number | null, min: number): Pick[] {
  const per = new Map<number, [number, number]>();
  let total = 0;
  for (const [c, r, g, w] of rows) {
    if (role != null && r !== role) continue;
    total += g;
    const t = per.get(c) ?? [0, 0];
    per.set(c, [t[0] + g, t[1] + w]);
  }
  return [...per.entries()]
    .filter(([, [g]]) => g >= min)
    .map(([champ, [games, wins]]) => ({ champ, games, wins, share: total ? games / total : 0 }))
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)
    .slice(0, 3);
}

function OwnBestPicks({ stats, data }: { stats: Stats; data: Personal }) {
  const [role, setRole] = useState<number | null>(null);
  const season = data.champions.reduce((a, [, , g]) => a + g, 0);
  const min = season < 200 ? 10 : 20;   // seuil adapté au nombre de parties de la saison
  const picks = bestPicks(data.champions, role, min);
  const where = role == null ? "" : t(" en {role}", { role: ROLE_LABELS[role] });
  return (
    <BestPicks stats={stats} picks={picks}
               sub={t("Tes 3 meilleurs champions{where} cette saison en Solo/Duo · minimum {min} parties", { where: where, min: min })}
               empty={t("Aucun champion avec {min} parties ou plus{where} cette saison.", { min: min, where: where })}
               filter={<RoleFilter role={role} onRole={setRole} />} />
  );
}

function BestPicks({ stats, picks, sub, empty, filter }: { stats: Stats; picks: Pick[]; sub: string; empty: string; filter?: React.ReactNode }) {
  return (
    <section className="best">
      <div>
        <h2>{t("Meilleurs picks")}</h2>
        <p className="muted small">{sub}</p>
      </div>
      {filter}
      {picks.length ? (
        <div className="best__cards">
          {picks.map((p, i) => (
            <div key={p.champ} className="best__card">
              <span className="best__rank">{i + 1}</span>
              <ChampionIcon stats={stats} champ={p.champ} size={2.5} />
              <span className="best__champ">
                <span className="best__name">{champName(stats, p.champ)}</span>
                <span className="muted small">{plural(p.games, "{n} partie", "{n} parties").replace(String(p.games), int(p.games))}</span>
              </span>
              <span className="best__stats">
                <span className={`best__wr tone-${wrTone(p.wins / p.games)}`}>{pct(p.wins / p.games)}<Trend tone={wrTone(p.wins / p.games)} /></span>
                <span className="muted small">{t("{n} % de pick", { n: Math.round(p.share * 100) })}</span>
              </span>
            </div>
          ))}
        </div>
      ) : <p className="hint">{empty}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Profil d'un autre joueur (via le client LoL)

function OtherProfile({ stats, puuid, me, assets, onBack, onOpenPlayer }:
  { stats: Stats; puuid: string; me: string | null; assets: Assets; onBack: () => void; onOpenPlayer: (puuid: string | null) => void }) {
  const guess = useGuess(stats);
  const [player, setPlayer] = useState<OtherPlayer | null>(null);
  const [error, setError] = useState(false);
  const [role, setRole] = useState<number | null>(null);
  const [pickRole, setPickRole] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("history");
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
  const rows = ranked.map((g) => [g.champ, g.role ?? -1, 1, g.win ? 1 : 0] as [number, number, number, number]);
  const picks = bestPicks(rows, pickRole, 3);

  return (
    <>
      <button className="link-back" onClick={onBack}>{t("← Ton profil")}</button>
      <header className="page-head">
        <div>
          <p className="overline">{t("Profil d’un joueur")}</p>
          <h1>{player?.name ?? (error ? t("Joueur introuvable") : "Chargement…")}</h1>
        </div>
      </header>
      {error && <p className="hint">{t("Le client LoL n’a pas renvoyé ce profil. Vérifie qu’il est ouvert, puis réessaie.")}</p>}
      {player && (
        <>
          <div className="card account">
            <ProfileIcon version={stats.ddragon} icon={player.icon} />
            <div className="grow">
              <p className="account__name">{player.name}</p>
              <p className="account__rank">{player.rank ? t("Classé Solo/Duo · {rank}", { rank: player.rank }) : t("Non classé en Solo/Duo")}</p>
              <p className="muted small">{t("Calculé sur ses 20 dernières parties, comme dans le client LoL.")}</p>
            </div>
            <span className="pill"><span className="dot" />{t("Via le client LoL")}</span>
          </div>
          {ranked.length > 0 && (
            <div className="tiles">
              <Tile label={t("Winrate récent")} value={pct(wins / ranked.length)} tone={wrTone(wins / ranked.length)}
                    detail={t("{n} sur {total}", { n: plural(wins, "{n} victoire", "{n} victoires"), total: plural(ranked.length, "{n} partie", "{n} parties") })} />
              <Tile label={t("Champion le plus joué")} stats={stats} champ={top?.[0]} value={top ? champName(stats, top[0]) : "—"}
                    detail={top ? t("{n} sur {total}", { n: plural(top[1], "{n} partie", "{n} parties"), total: ranked.length }) : ""} />
              <Tile label={t("Rôle principal")} value={roles[mainRole] ? ROLE_LABELS[mainRole] : "—"}
                    detail={roles[mainRole] ? t("{n} sur {total}", { n: plural(roles[mainRole], "{n} partie", "{n} parties"), total: ranked.length }) : ""} />
            </div>
          )}
          <ProfileTabs tab={tab} onTab={setTab} tabs={["history", "stats"]} />
          <div key={tab} className="profile-view fade-in">
          {tab === "stats" && (
            <BestPicks stats={stats} picks={picks}
                       sub={t("Sur ses 20 dernières parties (le client LoL ne donne pas plus) · minimum 3 parties")}
                       empty={t("Pas assez de parties sur un même champion pour ce filtre.")}
                       filter={<RoleFilter role={pickRole} onRole={setPickRole} />} />
          )}
          {tab === "history" && (
            <History stats={stats} games={player.games} assets={assets} role={role} onRole={setRole} me={me}
                     intro={t("Ses 20 dernières parties visibles dans le client LoL. Clique sur une partie pour voir le détail.")}
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
  title?: string; intro: string; empty?: string | null; error?: string | null;
  footer?: React.ReactNode; showLp?: boolean;
  onOpenPlayer: (puuid: string | null) => void;
  /** Historique filtré sur un partenaire de duo. */
  duo?: DuoFilter | null; onClearDuo?: () => void;
  /** Partie à déplier à l’ouverture (depuis un bilan de l’onglet Progression). */
  focus?: number | null;
}

/** Historique : filtre par file et par poste (le poste choisit aussi les meilleurs picks), ligne dépliable. */
function History({ stats, games, assets, role, onRole, me, subject, title, intro, empty, error, footer,
                   showLp = false, onOpenPlayer, duo, onClearDuo, focus = null }: HistoryProps) {
  const [queue, setQueue] = useState<"all" | QueueKind>("all");
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
        <p className="muted small">{intro}</p>
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
      {games && (
        <>
          <div className="history__filters">
            <Segmented className="segmented" role="tablist" aria-label={t("File")}>
              {QUEUES.map((q) => (
                <button key={q} role="tab" aria-selected={queue === q} className={queue === q ? "is-active" : ""}
                        onClick={() => setQueue(q)}>
                  {q === "all" ? t("Toutes") : QUEUE_LABELS[q]} <span className="count">{count(q)}</span>
                </button>
              ))}
            </Segmented>
            <Segmented className="segmented" role="tablist" aria-label={t("Poste (meilleurs picks et historique)")}>
              {[null, 0, 1, 2, 3, 4].map((r) => (
                <button key={String(r)} role="tab" aria-selected={role === r} className={role === r ? "is-active" : ""}
                        onClick={() => onRole(r)}>
                  {r == null ? t("Tous") : ROLE_LABELS[r]}{" "}
                  <span className="count">{r == null ? inQueue.length : inQueue.filter((g) => g.role === r).length}</span>
                </button>
              ))}
            </Segmented>
          </div>
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
    <button className={`game game--${result}${open ? " is-open" : ""}`} onClick={onToggle} aria-expanded={open}>
      <span className="game__bar" aria-hidden />
      <ChampionIcon stats={stats} champ={g.champ} size={2.5} />
      <Loadout spells={g.spells} keystone={g.keystone} subStyle={g.subStyle} assets={assets} size="md" />
      <span className="game__id">
        <span className="game__name">{champName(stats, g.champ)}</span>
        <span className="muted small">
          {partner ?? `${g.queue === "other" ? g.queueName : QUEUE_LABELS[g.queue]}${g.role != null ? ` · ${ROLE_LABELS[g.role]}` : ""}`} · {ago(g.created)}
        </span>
      </span>
      <ItemRow items={g.items} role={g.role} assets={assets} size="md" />
      <span className="grow" />
      <span className="stat-col game__note">
        <span className="stat-col__value">
          <span className={`tone-${rating ? noteTone(rating.note) : "neutral"}`}>{rating ? noteText(rating.note) : "—"}</span>
          {rating && <Trend tone={noteTone(rating.note)} />}
          <small> /20</small>
        </span>
        <span className="stat-col__label">
          {rating ? `${t("{rank} sur 10", { rank: ordinal(rating.rank) })}${rating.badge ? ` · ${rating.badge}` : ""}`
            : rating === null ? (g.remake ? t("Remake") : t("Note")) : "Calcul…"}
        </span>
      </span>
      <span className="game__sep" aria-hidden />
      <span className="stat-col game__kda">
        <span className="stat-col__value">{g.kills} / {g.deaths} / {g.assists}</span>
        <span className="stat-col__label">KDA {dec1(kda)} · {int(g.cs)} CS</span>
      </span>
      <span className="game__sep" aria-hidden />
      <span className="stat-col game__lp">
        {showLp ? (
          <span className={`game__lp-value${g.lp == null ? "" : g.lp > 0 ? " tone-good" : g.lp < 0 ? " tone-bad" : ""}`}>
            {g.lp == null ? t("— LP") : lpText(g.lp)}
          </span>
        ) : (
          <span className={`game__lp-value tone-${result === "remake" ? "neutral" : g.win ? "good" : "bad"}`}>
            {result === "remake" ? t("Remake") : g.win ? t("Victoire") : t("Défaite")}
          </span>
        )}
        <span className="stat-col__label">{showLp ? `${result === "remake" ? t("Remake") : g.win ? t("Victoire") : t("Défaite")} · ` : ""}{t("{n} min", { n: min })}</span>
      </span>
      <svg className="game__chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
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
    <div className="game-detail">
      {teams.map((team) => {
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
      <p className="muted small">{t("Note sur 20 calculée par rapport aux 9 autres joueurs (participation, dégâts, or, CS, vision et morts). MVP : meilleure note de l’équipe gagnante · ACE : meilleure note de l’équipe perdante. Clique sur un joueur pour ouvrir son profil.")}
      </p>
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

function ProfileTabs({ tab, onTab, tabs }: { tab: Tab; onTab: (t: Tab) => void; tabs: Tab[] }) {
  return (
    <div className="ptabs" role="tablist" aria-label={t("Sections du profil")}>
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => onTab(t)}>
          {TAB_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

function RoleFilter({ role, onRole }: { role: number | null; onRole: (r: number | null) => void }) {
  return (
    <Segmented className="segmented" role="tablist" aria-label={t("Rôle")}>
      {[null, 0, 1, 2, 3, 4].map((r) => (
        <button key={String(r)} role="tab" aria-selected={role === r} className={role === r ? "is-active" : ""} onClick={() => onRole(r)}>
          {r == null ? t("Tous") : ROLE_LABELS[r]}
        </button>
      ))}
    </Segmented>
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
        <p className="muted small">{t("Tes parties classées jouées avec Spec ouvert : le pick que Spec classait n°1, ou un autre.")}</p>
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
      <p className="muted small">{t("Tes parties en Solo/Duo avec d’autres joueurs qui ont lié leur compte Spec. Clique sur un profil pour voir vos parties ensemble dans l’onglet Historique.")}</p>
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
      <p className="muted small">{t("Les pseudos sont lus dans le client LoL (le serveur Spec n’en garde aucun) : ouvre le client pour les voir.")}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Progression : courbe des LP, winrate par semaine, bilan après chaque partie

const WEEK = 7 * 86400_000, WEEK_OFFSET = 4 * 86400_000;   // semaines du lundi (UTC), comme le serveur
const weekStart = (t: number) => Math.floor((t - WEEK_OFFSET) / WEEK) * WEEK + WEEK_OFFSET;
const shortDate = (t: number) => new Date(t).toLocaleDateString(locale(), { day: "numeric", month: "short" });

function ProgressView({ stats, games, perso, version, onOpenGame }:
  { stats: Stats; games: Game[] | null; perso: PersonalState; version: number; onOpenGame: (id: number) => void }) {
  const series = useMemo(() => readLpSeries(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  // winrate par semaine : serveur Spec (toute la saison) si les stats perso sont actives, sinon l’historique du client
  const weeks = useMemo(() => {
    const start = weekStart(Date.now()) - 7 * WEEK;
    const by = new Map<number, [number, number]>();
    for (let k = 0; k < 8; k++) by.set(start + k * WEEK, [0, 0]);
    if (perso.kind === "ready") {
      for (const [w, g, v] of perso.data.weeks) if (by.has(w)) by.set(w, [g, v]);
    } else {
      for (const g of games ?? []) {
        if (g.queue !== "solo" || g.remake) continue;
        const t = by.get(weekStart(g.created));
        if (t) { t[0] += 1; t[1] += g.win ? 1 : 0; }
      }
    }
    return [...by.entries()];
  }, [perso, games]);
  const list = useMemo(() => recaps(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const month = list.filter((r) => Date.now() - r.at < 30 * 86400_000);
  const followed = month.filter((r) => r.rank === 1).length;

  return (
    <>
      <section className="best">
        <div className="section-head">
          <div>
            <h2>{t("Évolution des LP")}</h2>
            <p className="muted small">{t("Solo/Duo · chaque point = une partie classée suivie par Spec")}</p>
          </div>
          {series.length > 0 && <span className="muted small">{t("Depuis le ")}{shortDate(series[0].at)}</span>}
        </div>
        <LpChart series={series} />
      </section>

      <section className="best">
        <div className="section-head">
          <div>
            <h2>{t("Winrate par semaine")}</h2>
            <p className="muted small">{t("Solo/Duo · la ligne pointillée marque 50 %")}</p>
          </div>
          <span className="muted small">{t("8 dernières semaines")}</span>
        </div>
        <WeekBars weeks={weeks} />
      </section>

      <section className="best">
        <div className="section-head">
          <div>
            <h2>{t("Après chaque partie")}</h2>
            <p className="muted small">{t("Ce que Spec t’avait conseillé, ce que tu as joué, et le résultat. Clique sur une partie pour ouvrir son détail.")}</p>
          </div>
          {month.length > 0 && <span className="muted small">{t("Ce mois-ci : conseil suivi {n} fois sur {total}", { n: followed, total: month.length })}</span>}
        </div>
        {list.length === 0 ? (
          <p className="hint">{t("Joue une partie classée avec Spec ouvert pendant la sélection des champions : son bilan s’affichera ici.")}</p>
        ) : (
          <div className="recaps stagger">
            {list.slice(0, 15).map((r) => <RecapRow key={r.game} stats={stats} recap={r} game={byId.get(r.game)} onOpen={() => onOpenGame(r.game)} />)}
          </div>
        )}
      </section>
    </>
  );
}

function LpChart({ series }: { series: LpPoint[] }) {
  if (series.length < 2) {
    return (
      <div className="card lp-card">
        <p className="hint">{t("La courbe démarre avec tes prochaines parties classées jouées avec Spec ouvert : le client LoL ne garde pas l’historique de tes LP.")}</p>
      </div>
    );
  }
  const pts = series.slice(-80);
  const first = pts[0], last = pts[pts.length - 1];
  const peak = pts.reduce((a, p) => (p.lp > a.lp ? p : a), first);
  const gain = last.lp - first.lp;
  // échelle : divisions entières autour des points (au moins 2 divisions visibles)
  let lo = Math.floor(Math.min(...pts.map((p) => p.lp)) / 100) * 100;
  let hi = Math.ceil((Math.max(...pts.map((p) => p.lp)) + 1) / 100) * 100;
  if (hi - lo < 200) { lo = Math.max(0, lo - 100); hi = lo + 200; }
  const W = 900, H = 200, L = 96, R = 12, T = 10, B = 176;
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, pts.length - 1);
  const y = (v: number) => T + (B - T) * (1 - (v - lo) / (hi - lo));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.lp).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${B} L${x(0).toFixed(1)} ${B} Z`;
  const bands: number[] = [];
  for (let v = lo; v <= hi; v += 100) bands.push(v);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (pts.length - 1)));
  const tone = gain > 0 ? "good" : gain < 0 ? "bad" : "neutral";
  return (
    <div className="card lp-card">
      <div className="lp-card__head">
        <div><span className="small muted">{t("Rang actuel")}</span><strong>{lpLabel(last.lp)}</strong></div>
        <div><span className="small muted">{t("Depuis le début du suivi")}</span>
          <strong className={`tone-${tone}`}>{gain > 0 ? "+" : gain < 0 ? "−" : ""}{Math.abs(gain)} LP<Trend tone={tone} /></strong></div>
        <div><span className="small muted">{t("Meilleur moment")}</span><strong>{lpLabel(peak.lp)}</strong></div>
      </div>
      <svg className="lp-chart" viewBox={`0 0 ${W} ${H + 20}`} role="img"
           aria-label={t("Courbe des LP : de {lpLabel} à {lpLabel2}", { lpLabel: lpLabel(first.lp), lpLabel2: lpLabel(last.lp) })}>
        <defs>
          <linearGradient id="lp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {bands.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="lp-chart__grid" />)}
        {bands.slice(0, -1).map((v) => (
          <text key={`t${v}`} x={0} y={(y(v) + y(v + 100)) / 2 + 4} className="lp-chart__label">{lpLabel(v, true)}</text>
        ))}
        <path d={area} fill="url(#lp-fill)" />
        <path d={line} className="lp-chart__line" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.lp)} r={i === pts.length - 1 ? 4.5 : 2.5}
                                   className={i === pts.length - 1 ? "lp-chart__last" : "lp-chart__dot"}>
          <title>{`${shortDate(p.at)} · ${lpLabel(p.lp)}`}</title>
        </circle>)}
        {[...new Set(ticks)].map((i) => (
          <text key={`d${i}`} x={x(i)} y={H + 14} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}
                className="lp-chart__label">{shortDate(pts[i].at)}</text>
        ))}
      </svg>
      <p className="muted small">{t("Les LP ne sont connus que pour les parties jouées avec Spec ouvert : le client LoL ne garde pas l’historique des LP.")}</p>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: [number, [number, number]][] }) {
  const total = weeks.reduce((a, [, [g]]) => a + g, 0);
  if (!total) return <div className="card"><p className="hint">{t("Aucune partie classée Solo/Duo ces 8 dernières semaines.")}</p></div>;
  return (
    <div className="card weeks">
      <div className="weeks__plot">
        <span className="weeks__half" aria-hidden />
        {weeks.map(([start, [g, w]]) => {
          const wr = g ? w / g : 0;
          const tone = !g ? "neutral" : wrTone(wr);
          // échelle 30 % → 70 % : les écarts autour de 50 % restent lisibles
          const h = g ? Math.max(4, Math.min(100, ((wr - 0.3) / 0.4) * 100)) : 0;
          return (
            <div key={start} className="weeks__col" title={g ? t("{n} sur {total}", { n: plural(w, "{n} victoire", "{n} victoires"), total: plural(g, "{n} partie", "{n} parties") }) : t("Aucune partie")}>
              <div className="weeks__bar-wrap">
                {g > 0 && <span className={`weeks__value tone-${tone}`}>{pct(wr)}<Trend tone={tone} /></span>}
                <span className={`weeks__bar tone-bg-${tone}`} style={{ height: `${h}%` }} />
              </div>
              <span className="weeks__label">{shortDate(start)}</span>
              <span className="weeks__games">{g ? plural(g, "{n} partie", "{n} parties") : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecapRow({ stats, recap: r, game, onOpen }: { stats: Stats; recap: Recap; game: Game | undefined; onOpen: () => void }) {
  const verdict = r.rank === 1 ? [t("Conseil suivi"), "good"] : r.rank != null && r.rank <= 3 ? [t("Dans le top 3"), "good"] : [t("Autre choix"), "neutral"];
  const result = game?.remake ? t("Remake") : r.win ? t("Victoire") : t("Défaite");
  return (
    <button className={`recap recap--${game?.remake ? "remake" : r.win ? "win" : "loss"}`} onClick={onOpen} disabled={!game}
            title={game ? t("Ouvrir le détail de la partie") : t("Partie plus chargée dans l’historique")}>
      <span className="game__bar" aria-hidden />
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
