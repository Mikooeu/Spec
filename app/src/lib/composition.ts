// Composition d'équipe : type de dégâts, frontline, engage et contrôle de chaque champion.
//
// Riot ne fournit pas ces infos : la table ci-dessous est faite à la main (à relire à chaque nouveau champion
// ou grosse refonte). Format de chaque entrée, 4 caractères :
//   1. dégâts : A = physiques, P = magiques, M = mixtes ; en minuscule si le champion fait peu de dégâts
//      (tank, enchanteur) : il compte moins dans la répartition AD/AP de l'équipe ;
//   2. frontline : 0 aucune, 1 peut encaisser un peu (bruiser), 2 vrai tank ;
//   3. engage : 0 aucun, 1 peut lancer un combat dans certains cas, 2 engage fiable ;
//   4. contrôle : 0 peu, 1 un peu, 2 beaucoup (étourdissements, projections, ralentissements de zone).
// Un champion absent de la table (sorti après la table) n'est simplement pas compté.
import type { Stats } from "./score";

const TABLE: Record<string, string> = {
  Aatrox: "A111", Ahri: "P001", Akali: "P000", Akshan: "A000", Alistar: "p222", Ambessa: "A111", Amumu: "p222",
  Anivia: "P002", Annie: "P012", Aphelios: "A001", Ashe: "A012", AurelionSol: "P011", Aurora: "P011", Azir: "P012",
  Bard: "p012", Belveth: "A100", Blitzcrank: "p112", Brand: "P001", Braum: "p202", Briar: "A110",
  Caitlyn: "A001", Camille: "A111", Cassiopeia: "P002", Chogath: "p212", Corki: "M000",
  Darius: "A101", Diana: "P121", DrMundo: "m200", Draven: "A001",
  Ekko: "P011", Elise: "P011", Evelynn: "P001", Ezreal: "A000",
  Fiddlesticks: "P021", Fiora: "A000", Fizz: "P001",
  Galio: "p222", Gangplank: "A001", Garen: "A100", Gnar: "A122", Gragas: "P122", Graves: "A000", Gwen: "P100",
  Hecarim: "A121", Heimerdinger: "P001", Hwei: "P002",
  Illaoi: "A100", Irelia: "A111", Ivern: "p001",
  Janna: "p002", JarvanIV: "A122", Jax: "M111", Jayce: "A000", Jhin: "A001", Jinx: "A001",
  KSante: "a212", Kaisa: "M000", Kalista: "A011", Karma: "p001", Karthus: "P000", Kassadin: "P000", Katarina: "P000",
  Kayle: "M000", Kayn: "A110", Kennen: "P022", Khazix: "A000", Kindred: "A000", Kled: "A120", KogMaw: "M000",
  Leblanc: "P001", LeeSin: "A111", Leona: "p222", Lillia: "P012", Lissandra: "P122", Lucian: "A000", Lulu: "p002", Lux: "P002",
  Malphite: "p222", Malzahar: "P012", Maokai: "p222", MasterYi: "A000", Mel: "P001", Milio: "p001", MissFortune: "A000",
  MonkeyKing: "A122", Mordekaiser: "P100", Morgana: "p002",
  Naafiri: "A010", Nami: "p012", Nasus: "A101", Nautilus: "p222", Neeko: "P022", Nidalee: "P000", Nilah: "A010",
  Nocturne: "A021", Nunu: "p212",
  Olaf: "A110", Orianna: "P012", Ornn: "p222",
  Pantheon: "A011", Poppy: "a212", Pyke: "A012",
  Qiyana: "A022", Quinn: "A000",
  Rakan: "p022", Rammus: "p222", RekSai: "A111", Rell: "p222", Renata: "p002", Renekton: "A111", Rengar: "A000",
  Riven: "A101", Rumble: "P111", Ryze: "P001",
  Samira: "A010", Sejuani: "p222", Senna: "A001", Seraphine: "P012", Sett: "A111", Shaco: "A001", Shen: "a211",
  Shyvana: "M110", Singed: "p211", Sion: "a222", Sivir: "A010", Skarner: "a222", Smolder: "A000", Sona: "p002",
  Soraka: "p001", Swain: "P112", Sylas: "P111", Syndra: "P002",
  TahmKench: "p211", Taliyah: "P011", Talon: "A000", Taric: "p212", Teemo: "P000", Thresh: "p112", Tristana: "A000",
  Trundle: "A101", Tryndamere: "A000", TwistedFate: "P001", Twitch: "A000",
  Udyr: "M111", Urgot: "A101",
  Varus: "A012", Vayne: "A000", Veigar: "P002", Velkoz: "P001", Vex: "P011", Vi: "A121", Viego: "A000", Viktor: "P001",
  Vladimir: "P000", Volibear: "M211",
  Warwick: "A112",
  Xayah: "A001", Xerath: "P001", XinZhao: "A121",
  Yasuo: "A011", Yone: "A011", Yorick: "A100", Yunara: "A000", Yuumi: "p001",
  Zaahen: "A111", Zac: "p222", Zed: "A000", Zeri: "A000", Ziggs: "P000", Zilean: "p001", Zoe: "P001", Zyra: "P002",
};

export interface Traits { ad: number; ap: number; weight: number; front: number; engage: number; cc: number }

export function traitsOf(stats: Stats, champ: number): Traits | null {
  const key = stats.champions.get(champ)?.key;
  const code = key ? TABLE[key] : undefined;
  if (!code) return null;
  const d = code[0];
  const [ad, ap] = d.toUpperCase() === "A" ? [0.9, 0.1] : d.toUpperCase() === "P" ? [0.1, 0.9] : [0.5, 0.5];
  return { ad, ap, weight: d === d.toUpperCase() ? 1 : 0.4, front: +code[1], engage: +code[2], cc: +code[3] };
}

export type Gap = "ap" | "ad" | "front" | "engage" | "cc";
export const GAP_LABEL: Record<Gap, string> = { ap: "AP", ad: "AD", front: "frontline", engage: "engage", cc: "contrôle" };

export interface TeamComp {
  known: number;                      // champions présents dans la table
  ad: number; ap: number;             // part des dégâts (0 à 1), dégâts bruts non distingués
  front: number; engage: number; cc: number;
  /** Alertes, de la plus grave à la moins grave. */
  issues: { gap: Gap; level: "bad" | "warn"; short: string; text: string }[];
}

/** Analyse d'une équipe (champions choisis ou présélectionnés). Pas d'alerte avant 3 champions connus. */
export function analyzeTeam(stats: Stats, champs: number[]): TeamComp {
  const ts = champs.map((c) => traitsOf(stats, c)).filter((t): t is Traits => t != null);
  const w = ts.reduce((a, t) => a + t.weight, 0);
  const ad = w ? ts.reduce((a, t) => a + t.ad * t.weight, 0) / w : 0.5;
  const front = ts.reduce((a, t) => a + t.front, 0), engage = ts.reduce((a, t) => a + t.engage, 0), cc = ts.reduce((a, t) => a + t.cc, 0);
  const issues: TeamComp["issues"] = [];
  if (ts.length >= 3) {
    const pctAd = Math.round(ad * 100);
    if (ad >= 0.75) issues.push({ gap: "ap", level: "bad", short: `${pctAd} % AD`,
      text: `${pctAd} % de dégâts physiques : l’adversaire n’a qu’à acheter de l’armure. Un pick AP équilibrerait.` });
    if (ad <= 0.25) issues.push({ gap: "ad", level: "bad", short: `${100 - pctAd} % AP`,
      text: `${100 - pctAd} % de dégâts magiques : l’adversaire n’a qu’à acheter de la résistance magique. Un pick AD équilibrerait.` });
    if (front < 2) issues.push({ gap: "front", level: front === 0 ? "bad" : "warn", short: "Frontline",
      text: front === 0 ? "Pas de frontline : personne pour encaisser en combat." : "Frontline légère : un seul champion peut encaisser un peu." });
    if (engage < 2) issues.push({ gap: "engage", level: engage === 0 ? "bad" : "warn", short: "Engage",
      text: engage === 0 ? "Pas d’engage : personne pour lancer les combats." : "Engage faible : un seul champion peut lancer un combat, et pas toujours." });
    if (cc < 3) issues.push({ gap: "cc", level: "warn", short: "Contrôle",
      text: "Peu de contrôle : difficile d’attraper ou de bloquer l’adversaire." });
  }
  return { known: ts.length, ad, ap: 1 - ad, front, engage, cc, issues };
}

/** Manques de l'équipe (sans toi) que ce champion comble. Vide si l'équipe n'a pas encore assez de picks. */
export function fills(stats: Stats, champ: number, team: TeamComp): Gap[] {
  const t = traitsOf(stats, champ);
  if (!t || team.known < 2) return [];
  const out: Gap[] = [];
  if (team.ad >= 0.7 && t.ap >= 0.5) out.push("ap");
  if (team.ad <= 0.3 && t.ad >= 0.5) out.push("ad");
  if (team.front < 2 && t.front >= 2 - team.front) out.push("front");
  if (team.engage < 2 && t.engage >= 2 - team.engage) out.push("engage");
  if (team.cc < 3 && t.cc === 2) out.push("cc");
  return out;
}

/**
 * Petit bonus de composition : un champion qui comble un manque passe devant celui juste au-dessus s'il n'en
 * comble aucun. Il ne gagne jamais plus d'une place, et le winrate Master+ garde le dernier mot pour le reste.
 */
export function bumpForComposition<T extends { champ: number }>(stats: Stats, list: T[], team: TeamComp): T[] {
  const out = [...list];
  const helps = out.map((r) => fills(stats, r.champ, team).length > 0);
  for (let i = 1; i < out.length; i++) {
    if (helps[i] && !helps[i - 1]) {
      [out[i - 1], out[i]] = [out[i], out[i - 1]];
      [helps[i - 1], helps[i]] = [helps[i], helps[i - 1]];   // la boucle avance : celui qui est monté ne remonte plus
    }
  }
  return out;
}
