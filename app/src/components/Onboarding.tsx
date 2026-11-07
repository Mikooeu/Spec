import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, gamesIn, type Stats } from "../lib/score";
import { champName, normalize } from "../lib/ui";
import { loadHistory, type Game } from "../lib/history";
import type { Account } from "../lib/lcu";
import type { PersonalState } from "../lib/api";
import type { Roles } from "../lib/settings";
import type { Pools } from "./PoolScreen";
import { ChampionIcon } from "./ChampionIcon";
import { Logo } from "./Logo";
import { RoleIcon } from "./RoleIcon";
import { t, plural } from "../lib/i18n";

interface Props {
  stats: Stats;
  roles: Roles; onRoles: (r: Roles) => void;
  pools: Pools; onPools: (p: Pools) => void;
  clientOn: boolean; account: Account | null; perso: PersonalState;
  onRegister: (code: string) => Promise<string | null>;
  onDone: () => void;
}

const STEPS = [t("Tes rôles"), t("Ton champion pool"), t("Ton compte")];

/** Premier lancement : rôles, champion pool, liaison du compte. Chaque étape peut être passée. */
export function Onboarding({ stats, roles, onRoles, pools, onPools, clientOn, account, perso, onRegister, onDone }: Props) {
  const [step, setStep] = useState(0);
  const chosen = [roles.main, roles.second].filter((r): r is number => r != null);
  const poolRoles = chosen.length ? chosen : [2];
  // onglet de rôle de l'étape pool, remonté ici pour que « Suivant » ouvre d'abord un rôle encore vide
  const [poolRole, setPoolRole] = useState(poolRoles[0]);
  const [seen, setSeen] = useState<number[]>([]);
  const role = poolRoles.includes(poolRole) ? poolRole : poolRoles[0];
  const openRole = (r: number) => { setSeen((v) => (v.includes(role) ? v : [...v, role])); setPoolRole(r); };
  const nextRole = step === 1 ? poolRoles.find((r) => r !== role && pools[r].length === 0 && !seen.includes(r)) : undefined;
  const next = () => {
    if (nextRole != null) openRole(nextRole);
    else if (step < 2) setStep(step + 1);
    else onDone();
  };
  return (
    <div className="onboarding">
      <div className="onboarding__inner">
        <div className="onboarding__top">
          <span className="onboarding__brand"><Logo className="brand__mark" />{t("Bienvenue sur Spec")}</span>
          <span className="grow" />
          {step < 2 && <button className="link-btn" onClick={onDone}>{t("Passer l’accueil")}</button>}
        </div>
        <ol className="steps" aria-label={t("Étapes")}>
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? "is-done" : i === step ? "is-current" : ""} aria-current={i === step ? "step" : undefined}>
              {i > 0 && <span className="steps__line" aria-hidden />}
              <span className="steps__dot">{i < step ? "✓" : i + 1}</span>{s}
            </li>
          ))}
        </ol>

        <div key={step} className="onboarding__body fade-in">
          {step === 0 && <RolesStep roles={roles} onRoles={onRoles} />}
          {step === 1 && <PoolStep stats={stats} roles={poolRoles} role={role} onRole={openRole} pools={pools} onPools={onPools} clientOn={clientOn} />}
          {step === 2 && <AccountStep clientOn={clientOn} account={account} perso={perso} onRegister={onRegister} />}
        </div>

        <div className="onboarding__foot">
          {step > 0 && <button className="btn btn--secondary" onClick={() => setStep(step - 1)}>{t("Retour")}</button>}
          <span className="grow" />
          <span className="muted small">{t("Étape {n} sur 3", { n: step + 1 })}</span>
          {step === 2 && perso.kind !== "ready" && <button className="btn btn--secondary" onClick={onDone}>{t("Plus tard")}</button>}
          <button className="btn btn--primary" onClick={next}>
            {nextRole != null ? t("Suivant : {role}", { role: ROLE_LABELS[nextRole] }) : step < 2 ? t("Suivant") : t("Terminer")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RolesStep({ roles, onRoles }: { roles: Roles; onRoles: (r: Roles) => void }) {
  // 1er clic : principal · 2e clic : secondaire · 3e clic : retirer
  const click = (r: number) => {
    if (roles.main === r) onRoles({ main: roles.second, second: null });
    else if (roles.second === r) onRoles({ ...roles, second: null });
    else if (roles.main == null) onRoles({ ...roles, main: r });
    else onRoles({ ...roles, second: r });
  };
  return (
    <>
      <div className="onboarding__head">
        <h1>{t("Quels rôles joues-tu ?")}</h1>
        <p className="muted">{t("Spec te recommande des picks pour le rôle que tu joues en draft. Choisis ton rôle principal, et un rôle secondaire si tu en as un.")}</p>
      </div>
      <div className="role-cards">
        {ROLE_LABELS.map((label, i) => {
          const state = roles.main === i ? t("Principal") : roles.second === i ? t("Secondaire") : null;
          return (
            <button key={label} className={`role-card${state ? ` is-${roles.main === i ? "main" : "second"}` : ""}`}
                    aria-pressed={!!state} onClick={() => click(i)}>
              <RoleIcon role={i} />
              <strong>{label}</strong>
              <span className="role-card__badge">{state ?? t("Choisir")}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">{t("Premier clic : rôle principal · deuxième clic : rôle secondaire · troisième clic : retirer. En draft, Spec suit toujours le rôle que le client t’attribue.")}</p>
    </>
  );
}

function PoolStep({ stats, roles, role, onRole, pools, onPools, clientOn }:
  { stats: Stats; roles: number[]; role: number; onRole: (r: number) => void; pools: Pools; onPools: (p: Pools) => void; clientOn: boolean }) {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Game[] | null>(null);
  useEffect(() => {
    if (!clientOn) return;
    let alive = true;
    loadHistory(20).then((g) => alive && setHistory(g)).catch(() => alive && setHistory([]));
    return () => { alive = false; };
  }, [clientOn]);
  // tes champions les plus joués dans ce rôle (historique du client LoL)
  const played = useMemo(() => {
    const count = new Map<number, number>();
    for (const g of history ?? []) if (g.role === role && !g.remake) count.set(g.champ, (count.get(g.champ) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [history, role]);
  const pool = pools[role];
  const set = (next: number[]) => { const p = pools.map((x) => [...x]); p[role] = next; onPools(p); };
  const toggle = (c: number) => set(pool.includes(c) ? pool.filter((x) => x !== c) : [...pool, c]);
  const list = useMemo(() => {
    const q = normalize(query);
    return [...stats.champions.values()]
      .filter((c) => (q ? normalize(c.name).includes(q) : gamesIn(stats, c.id, role) > 0))
      .sort((a, b) => gamesIn(stats, b.id, role) - gamesIn(stats, a.id, role) || a.name.localeCompare(b.name))
      .slice(0, q ? 40 : 15);
  }, [stats, role, query]);
  const missing = played.map(([c]) => c).filter((c) => !pool.includes(c));
  return (
    <>
      <div className="onboarding__head">
        <h1>{t("Ton champion pool")}</h1>
        <p className="muted">{t("Les champions que tu sais jouer. Spec les met en avant dans ses recommandations, et te propose aussi quelques découvertes hors de ton pool. Tu pourras le modifier à tout moment.")}</p>
      </div>
      {roles.length > 1 && (
        <div className="segmented" role="tablist" aria-label={t("Rôle")}>
          {roles.map((r) => (
            <button key={r} role="tab" aria-selected={role === r} className={role === r ? "is-active" : ""} onClick={() => onRole(r)}>
              {ROLE_LABELS[r]} <span className="count">{pools[r].length}</span>
              {pools[r].length === 0 && role !== r && <span className="tab-dot" title={t("Pool encore vide")} aria-label={t("Pool encore vide")} />}
            </button>
          ))}
        </div>
      )}
      {played.length > 0 && (
        <div className="card onboarding__suggest">
          <div className="onboarding__suggest-head">
            <div>
              <strong>{t("Tes champions les plus joués en ")}{ROLE_LABELS[role]}</strong>
              <p className="muted small">{t("Trouvés dans ton historique du client LoL · 20 dernières parties")}</p>
            </div>
            <button className="btn btn--secondary" disabled={!missing.length} onClick={() => set([...pool, ...missing])}>{t("Tout ajouter")}</button>
          </div>
          <div className="chips">
            {played.map(([c, n]) => (
              <button key={c} className={`chip${pool.includes(c) ? " is-on" : ""}`} aria-pressed={pool.includes(c)} onClick={() => toggle(c)}>
                <ChampionIcon stats={stats} champ={c} size={1.5} />
                {pool.includes(c) ? "✓ " : "+ "}{champName(stats, c)}<span className="muted small">{plural(n, "{n} partie", "{n} parties")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <input className="search" placeholder={t("Rechercher un champion")} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid onboarding__grid">
        {list.map((c) => (
          <button key={c.id} className={`tile${pool.includes(c.id) ? " is-selected" : ""}`} aria-pressed={pool.includes(c.id)} onClick={() => toggle(c.id)}>
            <ChampionIcon stats={stats} champ={c.id} size={2.5} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function AccountStep({ clientOn, account, perso, onRegister }:
  { clientOn: boolean; account: Account | null; perso: PersonalState; onRegister: (code: string) => Promise<string | null> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const done = perso.kind === "ready";
  const activate = async () => { setBusy(true); setMessage(await onRegister(code)); setBusy(false); };
  return (
    <>
      <div className="onboarding__head">
        <h1>{t("Lie ton compte League of Legends")}</h1>
        <p className="muted">{t("Avec ton compte lié, Spec retrouve toute ta saison en Solo/Duo : tes stats perso dans chaque draft, ton historique complet et tes parties en duo.")}</p>
      </div>
      <div className="card onboarding__account">
        <div className="grow">
          <strong>{account ? `${account.name}${account.region ? ` · ${account.region}` : ""}` : t("Aucun compte détecté")}</strong>
          <p className="muted small">{account ? t("Détecté dans le client LoL") : t("Lance le client LoL : ton compte sera détecté automatiquement.")}</p>
        </div>
        <span className="pill"><span className={clientOn ? "dot" : "dot dot--off"} />{clientOn ? t("Client connecté") : t("Client fermé")}</span>
      </div>
      {done ? (
        <p className="hint">{t("✓ Stats perso activées : Spec récupère ta saison en arrière-plan.")}</p>
      ) : (
        <form className="card onboarding__code" onSubmit={(e) => { e.preventDefault(); if (code.trim() && account) activate(); }}>
          <strong>{t("Code d’invitation")}</strong>
          <p className="muted small">{t("Spec est en accès privé : demande le code à la personne qui t’a invité. Il ne sert qu’une fois, pour lier ce compte à cet ordinateur.")}</p>
          <div className="onboarding__code-row">
            <input className="search search--code" placeholder="XXXX-XXXX" value={code} maxLength={9} spellCheck={false}
                   aria-label={t("Code d’invitation")} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn btn--primary" type="submit" disabled={busy || !code.trim() || !account}>{busy ? t("Activation…") : t("Activer")}</button>
          </div>
          {message && <p className="small tone-bad">{message}</p>}
        </form>
      )}
      <ul className="onboarding__gains">
        <li>{t("Tes stats perso dans chaque recommandation de draft")}</li>
        <li>{t("Toute ta saison dans l’historique, pas seulement les 20 dernières parties")}</li>
        <li>{t("Ton winrate et tes meilleurs combos avec les autres joueurs Spec")}</li>
      </ul>
    </>
  );
}

// Icônes officielles des postes (client LoL, servies par Community Dragon, comme l'emblème Master de la tier list)
