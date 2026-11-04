import { useEffect, useState } from "react";
import { REGIONS, type Region } from "../lib/api";
import type { Account } from "../lib/lcu";
import { useFlashKey } from "./Runes";
import { Segmented } from "./Segmented";
import { appVersion, autostartEnabled, installPath, revealInstall, setAutostart, useDefaultRegion, useLang } from "../lib/settings";
import type { CheckResult } from "../lib/updater";

interface Props {
  account: Account | null;
  registered: boolean;
  compact: boolean; onCompact: (on: boolean) => void;
  onTop: boolean; onOnTop: (on: boolean) => void;
  onCheckUpdate: () => Promise<CheckResult>;
  onReplayOnboarding: () => void;
}

/** Réglages : langue, démarrage, mode compact, touche du Flash, région par défaut, compte, dossier, version. */
export function SettingsScreen({ account, registered, compact, onCompact, onTop, onOnTop, onCheckUpdate, onReplayOnboarding }: Props) {
  const [lang, setLang] = useLang();
  const [flashKey, setFlashKey] = useFlashKey();
  const [region, setRegion] = useDefaultRegion();
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckResult | "checking" | null>(null);

  useEffect(() => {
    autostartEnabled().then(setAutostartState);
    installPath().then(setPath);
    appVersion().then(setVersion);
  }, []);

  const toggleAutostart = async () => {
    const next = !autostart;
    const err = await setAutostart(next);
    setAutostartError(err);
    if (!err) setAutostartState(next);
  };
  const runCheck = async () => { setCheck("checking"); setCheck(await onCheckUpdate()); };
  const folder = path ? path.replace(/[\\/][^\\/]+$/, "") : null;
  const checkText = check === "checking" ? "Recherche…" : check === "uptodate" ? "à jour" : check === "available" ? "mise à jour disponible (voir en bas à gauche)"
    : check === "error" ? "impossible de vérifier (hors ligne ?)" : check === "unavailable" ? "disponible dans l’appli installée" : null;

  return (
    <div className="content settings">
      <header className="page-head">
        <div>
          <p className="overline">Réglages</p>
          <h1>Réglages</h1>
        </div>
      </header>

      <Section title="Général">
        <Row label="Langue" desc="La langue de l’interface. L’anglais arrive avec la prochaine version : Spec reste en français d’ici là.">
          <Choice value={lang} onChange={setLang} options={[["fr", "Français"], ["en", "English"]]} disabled={["en"]} />
        </Row>
        <Row label="Lancer Spec au démarrage de Windows"
             desc={autostartError ?? "Spec s’ouvre réduit dans la barre des tâches à l’allumage du PC, prêt pour ta prochaine draft."}
             error={!!autostartError}>
          <Toggle on={!!autostart} onChange={toggleAutostart} disabled={autostart == null} label="Lancer Spec au démarrage de Windows" />
        </Row>
        <Row label="Ouvrir en mode compact" desc="La petite fenêtre à placer à côté du client LoL, au lieu de la fenêtre complète.">
          <Toggle on={compact} onChange={() => onCompact(!compact)} label="Ouvrir en mode compact" />
        </Row>
        <Row label="Toujours au premier plan en mode compact" desc="La fenêtre compacte reste visible par-dessus le client LoL.">
          <Toggle on={onTop} onChange={() => onOnTop(!onTop)} label="Toujours au premier plan en mode compact" />
        </Row>
      </Section>

      <Section title="Draft">
        <Row label="Touche du Flash" desc="L’ordre de tes sorts quand Spec les importe dans le client : Flash sur D ou sur F.">
          <Choice value={flashKey} onChange={setFlashKey} options={[["D", "D"], ["F", "F"]]} />
        </Row>
        <Row label="Région des stats par défaut"
             desc="Région affichée à l’ouverture de la tier list et des pages champion. La draft utilise toujours les stats EUW.">
          <Choice value={region} onChange={setRegion} options={REGIONS as [Region, string][]} />
        </Row>
      </Section>

      <Section title="Compte et appli">
        <Row label={account ? `${account.name}${account.region ? ` · ${account.region}` : ""}` : "Aucun compte détecté"}
             desc={account ? (registered ? "Stats perso activées · compte lié à cet ordinateur" : "Compte détecté, stats perso pas encore activées (onglet Profil)")
               : "Lance le client LoL : ton compte sera détecté automatiquement."}>
          <span className="muted small">{registered ? "Lié" : ""}</span>
        </Row>
        <Row label="Accueil" desc="Revoir les 3 étapes du premier lancement : rôles, champion pool, compte.">
          <button className="btn btn--secondary" onClick={onReplayOnboarding}>Revoir l’accueil</button>
        </Row>
        <Row label="Dossier d’installation"
             desc={`${folder ?? "Choisi à l’installation"} — pour le changer, désinstalle Spec puis réinstalle-le dans un autre dossier : ton pool et tes réglages sont gardés (ne coche pas la suppression des données).`}>
          <button className="btn btn--secondary" onClick={() => path && revealInstall(path)} disabled={!path}>Ouvrir le dossier</button>
        </Row>
        <Row label="Version" desc={`Spec ${version ?? "—"}${checkText ? ` · ${checkText}` : ""}`}>
          <button className="btn btn--secondary" onClick={runCheck} disabled={check === "checking"}>Rechercher une mise à jour</button>
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <h2>{title}</h2>
      <div className="card settings__card">{children}</div>
    </section>
  );
}

function Row({ label, desc, error = false, children }: { label: string; desc: string; error?: boolean; children: React.ReactNode }) {
  return (
    <div className="settings__row">
      <div className="settings__text">
        <span className="settings__label">{label}</span>
        <span className={`settings__desc${error ? " tone-bad" : ""}`}>{desc}</span>
      </div>
      <div className="settings__control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, disabled = false, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button className={`toggle${on ? " is-on" : ""}`} role="switch" aria-checked={on} aria-label={label}
            onClick={onChange} disabled={disabled}>
      <span className="toggle__knob" />
    </button>
  );
}

function Choice<T extends string>({ value, onChange, options, disabled = [] }:
  { value: T; onChange: (v: T) => void; options: [T, string][]; disabled?: T[] }) {
  return (
    <Segmented className="segmented" role="radiogroup">
      {options.map(([k, label]) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? "is-active" : ""}
                disabled={disabled.includes(k)} title={disabled.includes(k) ? "Bientôt disponible" : undefined}
                onClick={() => onChange(k)}>{label}</button>
      ))}
    </Segmented>
  );
}
