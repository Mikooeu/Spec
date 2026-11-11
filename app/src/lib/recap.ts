// Récap d'une partie terminée : ta lane face à ton vis-à-vis (à 15 min et en fin de partie), ton équipe,
// ce qui a joué pour ou contre toi, et tes déplacements. Tout vient du client LoL : le détail de la partie
// et sa timeline (une image par minute : or, CS et position de chaque joueur, plus les évènements).
import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { Stats } from "./score";
import { roleOf, type Guess, type RawGame, type RawParticipant } from "./history";
import { plural, t } from "./i18n";
import { int, pctN } from "./ui";

type PFrame = {
  participantId?: number; totalGold?: number; minionsKilled?: number; jungleMinionsKilled?: number;
  position?: { x: number; y: number };
  damageStats?: { totalDamageDoneToChampions?: number };
};
type TEvent = {
  type?: string; timestamp?: number; killerId?: number; victimId?: number; assistingParticipantIds?: number[];
  creatorId?: number; wardType?: string; position?: { x: number; y: number };
  monsterType?: string; buildingType?: string; teamId?: number; killerTeamId?: number;
};
type Timeline = { frames?: { timestamp?: number; participantFrames?: Record<string, PFrame>; events?: TEvent[] }[] };

/** Une ligne « toi / vis-à-vis » : null quand la donnée manque (vieille partie, timeline incomplète). */
export interface Duel { label: string; me: string; opp: string | null; diff: string | null; good: boolean | null }
export interface Point { title: string; detail: string; weight: number }
export interface Spot { x: number; y: number; min: number }   // x, y entre 0 et 1 (0,0 = coin bas gauche)
/** Une ligne de « Ta lane » : toi en bleu, ton vis-à-vis en rouge. */
export interface Bar { label: string; me: number; opp: number }
export type MarkKind = "kill" | "death" | "dragon" | "tower" | "baron" | "herald";
/** Un évènement placé sur la courbe : tes kills et tes morts, les objectifs des deux équipes. */
export interface Mark { min: number; kind: MarkKind; ally: boolean }

export interface Recap {
  gameId: number;
  win: boolean;
  remake: boolean;
  champ: number;
  role: number | null;
  side: 0 | 1;                 // 0 bleu, 1 rouge
  duration: number;            // secondes
  kills: number; deaths: number; assists: number;
  csMin: number;
  kp: number | null;           // participation aux kills, en %
  oppChamp: number | null;
  at15: Duel[] | null;         // null si la partie a fini avant 15 min ou sans timeline
  end: Duel[];
  team: {
    gold15: number | null; goldEnd: number;
    kills: [number, number]; towers: [number, number]; dragons: [number, number];
    barons: [number, number]; heralds: [number, number];
  };
  good: Point[];
  bad: Point[];
  brief: string;
  heat: { path: Spot[]; kills: Spot[]; deaths: Spot[] };
  /** Écart d'or de ton équipe minute par minute (vide sans timeline). */
  curve: { min: number; gold: number }[];
  marks: Mark[];
  /** Le moment où l'écart d'or a le plus bougé (3 minutes), dans le sens du résultat. */
  turn: { min: number; delta: number; detail: string } | null;
  lane: Bar[] | null;
  laneVerdict: "won" | "lost" | "even" | null;
  /** « À retenir pour la prochaine » (sans le conseil de draft, ajouté à l'affichage). */
  tips: Point[];
  /** Zones où tu as passé le plus de temps (« en top », « dans la rivière »…). */
  zones: string[];
}

const SR = { w: 14870, h: 14980 };    // taille de la Faille en unités de jeu
const MIN = 60_000;
const sign = (x: number, s = "") => (x > 0 ? `+${int(x)}${s}` : x < 0 ? `−${int(-x)}${s}` : `0${s}`);
const spot = (p: { x: number; y: number } | undefined, ms: number): Spot | null =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: Math.min(1, Math.max(0, p.x / SR.w)), y: Math.min(1, Math.max(0, p.y / SR.h)), min: ms / MIN } : null;

const cache = new Map<string, Promise<Recap | null>>();

/** Récap d'une partie pour un joueur (gardé en mémoire : une partie terminée ne change plus). null = pas de récap possible. */
export function loadRecap(gameId: number, me: string, guess?: Guess): Promise<Recap | null> {
  const key = `${gameId}:${me}`;
  if (!cache.has(key)) {
    if (cache.size > 50) cache.clear();
    cache.set(key, buildRecap(gameId, me, guess).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key)!;
}

async function buildRecap(gameId: number, me: string, guess?: Guess): Promise<Recap | null> {
  const [g, tl] = await Promise.all([
    invoke<RawGame>("lcu_game", { gameId }),
    invoke<Timeline>("lcu_timeline", { gameId }).catch(() => ({} as Timeline)),
  ]);
  return makeRecap(g, tl, me, guess);
}

/** Calcul du récap (séparé du chargement pour les tests). */
export function makeRecap(g: RawGame, tl: Timeline, me: string, guess?: Guess): Recap | null {
  const ids = new Map((g.participantIdentities ?? []).map((x) => [x.player?.puuid, x.participantId]));
  const myId = ids.get(me);
  const mine = g.participants.find((p) => p.participantId === myId);
  if (!mine || myId == null) return null;
  const myTeam = mine.teamId ?? 100;
  const duration = g.gameDuration > 10_000 ? Math.round(g.gameDuration / 1000) : g.gameDuration;
  const s = mine.stats;
  const remake = duration < 300 || !!s.gameEndedInEarlySurrender;
  const allies = g.participants.filter((p) => (p.teamId ?? 100) === myTeam);
  const enemies = g.participants.filter((p) => (p.teamId ?? 100) !== myTeam);
  const role = roleOf(mine, guess);
  const allyIds = new Set(allies.map((p) => p.participantId));
  const frames0 = tl.frames ?? [];
  // vis-à-vis : l'adversaire au même poste ; sinon celui qui a passé la phase de lane le plus près de toi (minutes 2 à 12)
  const near = (): RawParticipant | undefined => {
    let best: RawParticipant | undefined, bestD = Infinity;
    for (const e of enemies) {
      let sum = 0, n = 0;
      for (let m = 2; m <= 12 && m < frames0.length; m++) {
        const a = frames0[m]?.participantFrames?.[String(myId)]?.position, b = frames0[m]?.participantFrames?.[String(e.participantId)]?.position;
        if (a && b) { sum += Math.hypot(a.x - b.x, a.y - b.y); n++; }
      }
      if (n >= 3 && sum / n < bestD) { bestD = sum / n; best = e; }
    }
    return bestD < 4500 ? best : undefined;
  };
  const opp = (role != null ? enemies.find((p) => roleOf(p, guess) === role) : undefined) ?? near();

  const cs = (p: RawParticipant) => (p.stats.totalMinionsKilled ?? 0) + (p.stats.neutralMinionsKilled ?? 0);
  const sum = (ps: RawParticipant[], f: (p: RawParticipant) => number) => ps.reduce((a, p) => a + f(p), 0);
  const teamKills = sum(allies, (p) => p.stats.kills), enemyKills = sum(enemies, (p) => p.stats.kills);
  const kp = teamKills ? Math.round(((s.kills + s.assists) / teamKills) * 100) : null;
  const oppKp = opp ? (() => { const k = enemyKills; return k ? Math.round(((opp.stats.kills + opp.stats.assists) / k) * 100) : null; })() : null;

  // timeline
  const frames = tl.frames ?? [];
  const events = frames.flatMap((f) => f.events ?? []);
  const frameAt = (min: number, id: number | undefined) => frames[min]?.participantFrames?.[String(id)];
  const has15 = frames.length > 15 && duration >= 15 * 60;
  const before15 = (e: TEvent) => (e.timestamp ?? Infinity) < 15 * MIN;
  const kills = events.filter((e) => e.type === "CHAMPION_KILL");
  const isMe = (id?: number) => id === myId;
  const inFight = (e: TEvent, id: number | undefined) => e.killerId === id || (e.assistingParticipantIds ?? []).includes(id ?? -1);
  const teamOf = (id?: number) => (allyIds.has(id) ? "ally" : "enemy");

  // --- ta lane
  const at15: Duel[] | null = (() => {
    if (!has15) return null;
    const a = frameAt(15, myId), b = opp ? frameAt(15, opp.participantId) : undefined;
    if (!a) return null;
    const csOf = (f?: PFrame) => (f ? (f.minionsKilled ?? 0) + (f.jungleMinionsKilled ?? 0) : null);
    const kills15 = kills.filter(before15);
    const kpAt = (id: number | undefined, team: "ally" | "enemy") => {
      const tk = kills15.filter((e) => teamOf(e.killerId) === team).length;
      return tk ? Math.round((kills15.filter((e) => inFight(e, id)).length / tk) * 100) : 0;
    };
    const wards = (id: number | undefined) => events.filter((e) => e.type === "WARD_PLACED" && e.creatorId === id && before15(e)
      && e.wardType !== "UNDEFINED" && e.wardType !== "TEEMO_MUSHROOM").length;
    const dmg = (f?: PFrame) => f?.damageStats?.totalDamageDoneToChampions ?? null;
    return [
      duel(t("CS"), csOf(a)!, csOf(b)),
      duel(t("Or"), a.totalGold ?? 0, b?.totalGold ?? null),
      ...(dmg(a) != null ? [duel(t("Dégâts aux champions"), dmg(a)!, dmg(b))] : []),
      duel(t("Participation aux kills"), kpAt(myId, "ally"), opp ? kpAt(opp.participantId, "enemy") : null, "pct"),
      // balises : seulement si la timeline contient les poses de balises (pas toujours le cas dans le client)
      ...(events.some((e) => e.type === "WARD_PLACED") ? [duel(t("Balises posées"), wards(myId), opp ? wards(opp.participantId) : null)] : []),
    ];
  })();
  const end: Duel[] = [
    duel(t("CS"), cs(mine), opp ? cs(opp) : null),
    duel(t("Or"), s.goldEarned ?? 0, opp?.stats.goldEarned ?? null),
    duel(t("Dégâts aux champions"), s.totalDamageDealtToChampions ?? 0, opp?.stats.totalDamageDealtToChampions ?? null),
    ...(kp != null ? [duel(t("Participation aux kills"), kp, oppKp, "pct")] : []),
    ...(Number.isFinite(s.visionScore) ? [duel(t("Score de vision"), s.visionScore!, opp?.stats.visionScore ?? null)] : []),
  ];

  // --- ton équipe
  const teamGold15 = has15 ? (() => {
    const tg = (ps: RawParticipant[]) => ps.reduce((acc, p) => acc + (frameAt(15, p.participantId)?.totalGold ?? 0), 0);
    return tg(allies) - tg(enemies);
  })() : null;
  const goldEnd = sum(allies, (p) => p.stats.goldEarned ?? 0) - sum(enemies, (p) => p.stats.goldEarned ?? 0);
  const tRow = (id: number) => (g.teams ?? []).find((x) => x.teamId === id);
  const enemyTeam = myTeam === 100 ? 200 : 100;
  const monsters = events.filter((e) => e.type === "ELITE_MONSTER_KILL");
  const byEvents = (type: string, team: "ally" | "enemy") =>
    monsters.filter((e) => e.monsterType === type && (e.killerTeamId != null ? (e.killerTeamId === myTeam) === (team === "ally") : teamOf(e.killerId) === team)).length;
  const obj = (field: "towerKills" | "dragonKills" | "baronKills" | "riftHeraldKills", ev?: string): [number, number] => {
    const a = tRow(myTeam)?.[field], b = tRow(enemyTeam)?.[field];
    if (Number.isFinite(a) && Number.isFinite(b)) return [a!, b!];
    if (ev) return [byEvents(ev, "ally"), byEvents(ev, "enemy")];
    // tours : bâtiments détruits (teamId = équipe qui perd le bâtiment)
    const towers = events.filter((e) => e.type === "BUILDING_KILL" && e.buildingType === "TOWER_BUILDING");
    return [towers.filter((e) => e.teamId === enemyTeam).length, towers.filter((e) => e.teamId === myTeam).length];
  };
  const team = {
    gold15: teamGold15, goldEnd, kills: [teamKills, enemyKills] as [number, number],
    towers: obj("towerKills"), dragons: obj("dragonKills", "DRAGON"), barons: obj("baronKills", "BARON_NASHOR"),
    heralds: obj("riftHeraldKills", "RIFTHERALD"),
  };

  // --- ce qui a joué
  const good: Point[] = [], bad: Point[] = [];
  const push = (ok: boolean, p: Point) => (ok ? good : bad).push(p);
  const oppName = "{opp}";   // remplacé à l'affichage par le nom du champion adverse
  const laneRole = role != null && role !== 1 && role !== 4;   // jungle et support : le CS ne dit pas grand-chose
  if (has15 && opp) {
    const a = frameAt(15, myId), b = frameAt(15, opp.participantId);
    if (a && b) {
      const dCs = (a.minionsKilled ?? 0) + (a.jungleMinionsKilled ?? 0) - (b.minionsKilled ?? 0) - (b.jungleMinionsKilled ?? 0);
      const dGold = (a.totalGold ?? 0) - (b.totalGold ?? 0);
      if (dGold >= 500 || (laneRole && dCs >= 10))
        push(true, { title: t("Lane gagnée"), detail: t("{cs} CS et {gold} d’or sur {opp} à 15 min", { cs: sign(dCs), gold: sign(dGold), opp: oppName }), weight: dGold / 500 + (laneRole ? dCs / 10 : 0) });
      else if (dGold <= -500 || (laneRole && dCs <= -10))
        push(false, { title: t("Lane perdue"), detail: t("{cs} CS et {gold} d’or face à {opp} à 15 min", { cs: sign(dCs), gold: sign(dGold), opp: oppName }), weight: -dGold / 500 + (laneRole ? -dCs / 10 : 0) });
    }
  }
  if (has15) {
    const early = kills.filter((e) => before15(e) && isMe(e.victimId)).length;
    if (early >= 3) push(false, { title: t("Morts en début de partie"), detail: t("{n} morts avant 15 min", { n: early }), weight: early - 1 });
    else if (early === 0) push(true, { title: t("Début de partie propre"), detail: t("Aucune mort avant 15 min"), weight: 1.5 });
  }
  if (kp != null && teamKills >= 10) {
    if (kp >= 60) push(true, { title: t("Présent dans les combats"), detail: t("{kp} de participation aux kills", { kp: pctN(kp) }), weight: (kp - 50) / 8 });
    else if (kp <= 35) push(false, { title: t("Peu présent dans les combats"), detail: t("{kp} de participation aux kills", { kp: pctN(kp) }), weight: (45 - kp) / 8 });
  }
  if (opp && (opp.stats.totalDamageDealtToChampions ?? 0) > 0) {
    const a = s.totalDamageDealtToChampions ?? 0, b = opp.stats.totalDamageDealtToChampions ?? 0, r = a / b - 1;
    if (r >= 0.25) push(true, { title: t("Dégâts"), detail: t("{d} dégâts de plus que {opp}", { d: int(a - b), opp: oppName }), weight: r * 5 });
    else if (r <= -0.25) push(false, { title: t("Dégâts"), detail: t("{d} dégâts de moins que {opp}", { d: int(b - a), opp: oppName }), weight: -r * 5 });
  }
  if (opp && Number.isFinite(s.visionScore) && Number.isFinite(opp.stats.visionScore)) {
    const d = s.visionScore! - opp.stats.visionScore!;
    if (d >= 10) push(true, { title: t("Bonne vision"), detail: t("{v} de score de vision, {d} de plus que {opp}", { v: s.visionScore!, d, opp: oppName }), weight: d / 6 });
    else if (d <= -10) push(false, { title: t("Vision faible"), detail: t("{v} de score de vision, {d} de moins que {opp}", { v: s.visionScore!, d: -d, opp: oppName }), weight: -d / 6 });
  }
  if (teamGold15 != null) {
    if (teamGold15 >= 1500) push(true, { title: t("Équipe devant à 15 min"), detail: t("{g} d’or d’avance", { g: sign(teamGold15) }), weight: teamGold15 / 1500 });
    else if (teamGold15 <= -1500) push(false, { title: t("Équipe en retard à 15 min"), detail: t("{g} d’or de retard", { g: int(-teamGold15) }), weight: -teamGold15 / 1500 });
  }
  const dDrag = team.dragons[0] - team.dragons[1];
  if (dDrag >= 2) push(true, { title: t("Dragons"), detail: t("{a} dragons pris contre {b}", { a: team.dragons[0], b: team.dragons[1] }), weight: dDrag });
  else if (dDrag <= -2) push(false, { title: t("Dragons perdus"), detail: t("{b} dragons pris par l’adversaire contre {a}", { a: team.dragons[0], b: team.dragons[1] }), weight: -dDrag });
  if (team.barons[0] !== team.barons[1]) {
    const ok = team.barons[0] > team.barons[1];
    push(ok, { title: ok ? t("Nashor") : t("Nashor perdu"), detail: ok ? t("{n} Nashor pris par ton équipe", { n: team.barons[0] }) : t("{n} Nashor pris par l’adversaire", { n: team.barons[1] }), weight: 2 });
  }
  if (s.deaths <= 2 && duration >= 20 * 60) push(true, { title: t("Peu de morts"), detail: t("{n} mort{s} sur toute la partie", { n: s.deaths, s: s.deaths > 1 ? "s" : "" }), weight: 2 - s.deaths / 2 });
  else if (s.deaths >= 8) push(false, { title: t("Beaucoup de morts"), detail: t("{n} morts sur toute la partie", { n: s.deaths }), weight: s.deaths / 4 });
  const top = (ps: Point[]) => ps.sort((a, b) => b.weight - a.weight).slice(0, 3);

  // --- en bref
  const laneGold = has15 && opp ? (frameAt(15, myId)?.totalGold ?? 0) - (frameAt(15, opp.participantId)?.totalGold ?? 0) : null;
  const lane = laneGold == null ? null : laneGold >= 500 ? t("Lane gagnée") : laneGold <= -500 ? t("Lane perdue") : t("Lane équilibrée");
  const t15 = teamGold15 == null ? null : teamGold15 >= 1500 ? t("équipe devant à 15 min") : teamGold15 <= -1500 ? t("équipe en retard à 15 min") : t("équipe à égalité à 15 min");
  const win = !!s.win;
  const after = teamGold15 == null ? (win ? t("Partie gagnée.") : t("Partie perdue."))
    : win ? (teamGold15 <= -1500 ? t("La partie s’est retournée ensuite.") : t("Avance gardée jusqu’à la fin."))
      : (teamGold15 >= 1500 ? t("L’avance a été perdue ensuite.") : t("Le retard n’a pas été rattrapé."));
  const brief = [lane && t15 ? `${lane}, ${t15}.` : lane ? `${lane}.` : t15 ? `${t15[0].toUpperCase()}${t15.slice(1)}.` : "", after].filter(Boolean).join(" ");

  // --- déplacements
  const path: Spot[] = frames.map((f, i) => spot(f.participantFrames?.[String(myId)]?.position, f.timestamp ?? i * MIN)).filter((x): x is Spot => !!x && x.min > 0.5);
  const heat = {
    path,
    kills: kills.filter((e) => isMe(e.killerId)).map((e) => spot(e.position, e.timestamp ?? 0)).filter((x): x is Spot => !!x),
    deaths: kills.filter((e) => isMe(e.victimId)).map((e) => spot(e.position, e.timestamp ?? 0)).filter((x): x is Spot => !!x),
  };

  // --- courbe d'écart d'or et évènements
  const curve = frames.map((f, i) => {
    const tg = (ps: RawParticipant[]) => ps.reduce((acc, p) => acc + (f.participantFrames?.[String(p.participantId)]?.totalGold ?? 0), 0);
    return { min: Math.min((f.timestamp ?? i * MIN) / MIN, duration / 60), gold: tg(allies) - tg(enemies) };
  }).filter((p, i, a) => i === 0 || p.min > a[i - 1].min);
  const minOf = (e: TEvent) => (e.timestamp ?? 0) / MIN;
  const marks: Mark[] = [
    ...kills.filter((e) => isMe(e.killerId)).map((e) => ({ min: minOf(e), kind: "kill" as const, ally: true })),
    ...kills.filter((e) => isMe(e.victimId)).map((e) => ({ min: minOf(e), kind: "death" as const, ally: false })),
    ...monsters.filter((e) => e.monsterType === "DRAGON" || e.monsterType === "BARON_NASHOR" || e.monsterType === "RIFTHERALD").map((e) => ({
      min: minOf(e), kind: (e.monsterType === "DRAGON" ? "dragon" : e.monsterType === "BARON_NASHOR" ? "baron" : "herald") as MarkKind,
      ally: e.killerTeamId != null ? e.killerTeamId === myTeam : teamOf(e.killerId) === "ally" })),
    ...events.filter((e) => e.type === "BUILDING_KILL" && e.buildingType === "TOWER_BUILDING").map((e) => ({ min: minOf(e), kind: "tower" as const, ally: e.teamId !== myTeam })),
  ].sort((a, b) => a.min - b.min);

  // --- le tournant : la plus grosse variation sur 3 minutes, dans le sens du résultat
  const turn = (() => {
    if (curve.length < 6) return null;
    let best: { i: number; d: number } | null = null;
    for (let i = 0; i + 3 < curve.length; i++) {
      const d = curve[i + 3].gold - curve[i].gold;
      if ((win ? d > 0 : d < 0) && (!best || Math.abs(d) > Math.abs(best.d))) best = { i, d };
    }
    if (!best || Math.abs(best.d) < 1000) return null;
    const from = curve[best.i].min, to = curve[best.i + 3].min;
    const inWin = marks.filter((m) => m.min >= from && m.min <= to);
    const ours = win;   // ce qui explique le tournant : vos objectifs si tu as gagné, les leurs sinon
    const objs = (k: MarkKind, one: string, many: string) => {
      const n = inWin.filter((m) => m.kind === k && m.ally === ours).length;
      return n ? plural(n, one, many) : null;
    };
    const teamDeaths = kills.filter((e) => minOf(e) >= from && minOf(e) <= to && teamOf(e.victimId) === (win ? "enemy" : "ally")).length;
    const parts = [
      objs("baron", win ? "Nashor pris" : "Nashor perdu", win ? "Nashor pris" : "Nashor perdu"),
      objs("dragon", win ? "{n} dragon pris" : "{n} dragon perdu", win ? "{n} dragons pris" : "{n} dragons perdus"),
      objs("herald", win ? "Héraut pris" : "Héraut perdu", win ? "Héraut pris" : "Héraut perdu"),
      objs("tower", win ? "{n} tour prise" : "{n} tour perdue", win ? "{n} tours prises" : "{n} tours perdues"),
      teamDeaths ? (win ? plural(teamDeaths, "{n} kill", "{n} kills") : plural(teamDeaths, "{n} mort dans ton équipe", "{n} morts dans ton équipe")) : null,
    ].filter((x): x is string => !!x).slice(0, 3);
    const mid = curve[best.i + 1].min;
    return { min: Math.round(mid), delta: best.d, detail: `${parts.join(" + ")}${parts.length ? " : " : ""}${sign(best.d)}` };
  })();

  // --- ta lane : barres toi / vis-à-vis
  const solo = (killer?: number, victim?: number) => kills.filter((e) => e.killerId === killer && e.victimId === victim && !(e.assistingParticipantIds ?? []).length).length;
  const plates = events.filter((e) => e.type === "TURRET_PLATE_DESTROYED");
  const laneBars: Bar[] | null = opp ? (() => {
    const a = has15 ? frameAt(15, myId) : undefined, b = has15 ? frameAt(15, opp.participantId) : undefined;
    const csOf = (f: PFrame) => (f.minionsKilled ?? 0) + (f.jungleMinionsKilled ?? 0);
    const out: Bar[] = [];
    if (a && b) {
      out.push({ label: t("CS à 15 min"), me: csOf(a), opp: csOf(b) });
      out.push({ label: t("Or à 15 min"), me: a.totalGold ?? 0, opp: b.totalGold ?? 0 });
    } else {
      out.push({ label: t("CS"), me: cs(mine), opp: cs(opp) });
      out.push({ label: t("Or"), me: s.goldEarned ?? 0, opp: opp.stats.goldEarned ?? 0 });
    }
    if (frames.length) out.push({ label: t("Solo kills"), me: solo(myId, opp.participantId), opp: solo(opp.participantId, myId) });
    // plaques : seulement si la timeline les contient (pas toujours le cas dans le client)
    if (plates.length) out.push({ label: t("Plaques de tour"), me: plates.filter((e) => e.killerId === myId).length, opp: plates.filter((e) => e.killerId === opp.participantId).length });
    out.push({ label: t("Dégâts aux champions"), me: s.totalDamageDealtToChampions ?? 0, opp: opp.stats.totalDamageDealtToChampions ?? 0 });
    return out;
  })() : null;
  const laneVerdict = laneGold == null ? null : laneGold >= 500 ? "won" : laneGold <= -500 ? "lost" : "even";

  // --- à retenir
  const tips: Point[] = [];
  if (laneGold != null && laneGold >= 500 && teamGold15 != null && goldEnd < teamGold15) {
    const after = (k: MarkKind) => marks.filter((m) => m.kind === k && m.ally && m.min >= 15).length;
    tips.push({ title: t("Convertis ton avance"), detail: t("{g} d’or d’avance sur {opp} à 15 min, puis {d} et {tw} pour ton équipe ensuite.", {
      g: int(laneGold), opp: oppName, d: plural(after("dragon"), "{n} dragon", "{n} dragons"), tw: plural(after("tower"), "{n} tour", "{n} tours") }), weight: 3 });
  }
  const lateDeaths = kills.filter((e) => isMe(e.victimId) && minOf(e) >= 20).length;
  const earlyDeaths = kills.filter((e) => isMe(e.victimId) && minOf(e) < 15).length;
  if (lateDeaths >= 3) tips.push({ title: t("Évite les morts après 20 min"), detail: t("{n} morts sur tes {d} : c’est là que les combats se jouent.", { n: lateDeaths, d: s.deaths }), weight: lateDeaths });
  if (earlyDeaths >= 3) tips.push({ title: t("Joue plus prudemment en début de partie"), detail: t("{n} morts avant 15 min.", { n: earlyDeaths }), weight: earlyDeaths });
  for (const p of top([...bad])) if (tips.length < 3 && !tips.some((x) => x.title === p.title)) tips.push(p);
  if (win) for (const p of top([...good])) if (tips.length < 3) tips.push(p);

  // --- zones
  const zoneOf = (p: Spot) => {
    const { x, y } = p;
    if ((x < 0.22 && y < 0.22) || (x > 0.78 && y > 0.78)) return t("dans ta base");
    if (x < 0.2 || y > 0.8) return t("en top");
    if (y < 0.2 || x > 0.8) return t("en bot");
    if (Math.abs(x - y) < 0.1) return t("en mid");
    if (Math.abs(x + y - 1) < 0.09) return t("dans la rivière");
    return t("dans la jungle");
  };
  const zc = new Map<string, number>();
  for (const p of path) if (p.min >= 1.5) zc.set(zoneOf(p), (zc.get(zoneOf(p)) ?? 0) + 1);
  const zones = [...zc.entries()].filter(([z]) => z !== t("dans ta base")).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([z]) => z);

  return {
    gameId: g.gameId, win, remake, champ: mine.championId, role, side: myTeam === 200 ? 1 : 0, duration,
    kills: s.kills, deaths: s.deaths, assists: s.assists, csMin: duration ? cs(mine) / (duration / 60) : 0, kp,
    oppChamp: opp?.championId ?? null, at15, end, team, good: top(good), bad: top(bad), brief, heat,
    curve, marks, turn, lane: laneBars, laneVerdict, tips: tips.slice(0, 3), zones,
  };
}

function duel(label: string, me: number, opp: number | null, kind: "int" | "pct" = "int"): Duel {
  const f = (x: number) => (kind === "pct" ? pctN(x) : int(x));
  const d = opp == null ? null : me - opp;
  return { label, me: f(me), opp: opp == null ? null : f(opp), diff: d == null ? null : sign(d, kind === "pct" ? t(" pts") : ""), good: d == null ? null : d >= 0 };
}

/** Poste probable d'un champion d'après les parties Master+, quand le client ne le donne pas. */
export function useRoleGuess(stats: Stats): Guess {
  return useMemo(() => Object.assign((champ: number, notJungle: boolean) => {
    const dist = stats.roleGames.get(champ);
    if (!dist) return null;
    let best: number | null = null;
    dist.forEach((g, r) => { if ((!notJungle || r !== 1) && g > 0 && (best == null || g > dist[best])) best = r; });
    return best;
  }, { dist: (champ: number) => stats.roleGames.get(champ) ?? null }), [stats]);
}
