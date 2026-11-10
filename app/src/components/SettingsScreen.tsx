import { useEffect, useState } from "react";
import { REGIONS, type Region } from "../lib/api";
import type { Account } from "../lib/lcu";
import { useFlashKey } from "./Runes";
import { Segmented } from "./Segmented";
import { appVersion, autostartEnabled, installPath, revealInstall, setAutostart, useDefaultRegion, useLang } from "../lib/settings";
import type { CheckResult } from "../lib/updater";
import { t } from "../lib/i18n";

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
  const checkText = check === "checking" ? "Recherche…" : check === "uptodate" ? t("à jour") : check === "available" ? t("mise à jour disponible (voir en bas à gauche)")
    : check === "error" ? t("impossible de vérifier (hors ligne ?)") : check === "unavailable" ? t("disponible dans l’appli installée") : null;

  return (
    <div className="content settings">
      <header className="page-head">
        <div>
          <h1>{t("Réglages")}</h1>
        </div>
      </header>

      <Section title={t("Général")}>
        <Row label={t("Langue")} desc={t("La langue de l’interface. Les noms des champions, objets, sorts et runes suivent la même langue.")}>
          <Choice value={lang} onChange={(l) => { sessionStorage.setItem("spec.reopen", "settings"); setLang(l); }} options={[["fr", t("Français")], ["en", t("English")]]} />
        </Row>
        <Row label={t("Lancer Spec au démarrage de Windows")}
             desc={autostartError ?? t("Spec s’ouvre réduit dans la barre des tâches à l’allumage du PC, prêt pour ta prochaine draft.")}
             error={!!autostartError}>
          <Toggle on={!!autostart} onChange={toggleAutostart} disabled={autostart == null} label={t("Lancer Spec au démarrage de Windows")} />
        </Row>
        <Row label={t("Ouvrir en mode compact")} desc={t("La petite fenêtre à placer à côté du client LoL, au lieu de la fenêtre complète.")}>
          <Toggle on={compact} onChange={() => onCompact(!compact)} label={t("Ouvrir en mode compact")} />
        </Row>
        <Row label={t("Toujours au premier plan en mode compact")} desc={t("La fenêtre compacte reste visible par-dessus le client LoL.")}>
          <Toggle on={onTop} onChange={() => onOnTop(!onTop)} label={t("Toujours au premier plan en mode compact")} />
        </Row>
      </Section>

      <Section title={t("Draft")}>
        <Row label={t("Touche du Flash")} desc={t("L’ordre de tes sorts quand Spec les importe dans le client : Flash sur D ou sur F.")}>
          <Choice value={flashKey} onChange={setFlashKey} options={[["D", "D"], ["F", "F"]]} />
        </Row>
        <Row label={t("Région des stats par défaut")}
             desc={t("Région affichée à l’ouverture de la tier list et des pages champion. La draft utilise toujours les stats EUW.")}>
          <Choice value={region} onChange={setRegion} options={REGIONS as [Region, string][]} />
        </Row>
      </Section>

      <Section title={t("Compte et appli")}>
        <Row label={account ? `${account.name}${account.region ? ` · ${account.region}` : ""}` : t("Aucun compte détecté")}
             desc={account ? (registered ? t("Stats perso activées · compte lié à cet ordinateur") : t("Compte détecté, stats perso pas encore activées (onglet Profil)"))
               : t("Lance le client LoL : ton compte sera détecté automatiquement.")}>
          <span className="muted small">{registered ? t("Lié") : ""}</span>
        </Row>
        <Row label={t("Accueil")} desc={t("Revoir les 3 étapes du premier lancement : rôles, champion pool, compte.")}>
          <button className="btn btn--secondary" onClick={onReplayOnboarding}>{t("Revoir l’accueil")}</button>
        </Row>
        <Row label={t("Dossier d’installation")}
             desc={t("{v} · Pour déplacer Spec : désinstalle-le puis réinstalle-le en choisissant le dossier. Ton pool et tes réglages sont gardés.", { v: folder ?? t("Choisi à l’installation") })}>
          <button className="btn btn--secondary" onClick={() => path && revealInstall(path)} disabled={!path}>{t("Ouvrir le dossier")}</button>
        </Row>
        <Row label={t("Version")} desc={t("Spec {v}{v2}", { v: version ?? "—", v2: checkText ? ` · ${checkText}` : "" })}>
          <button className="btn btn--secondary" onClick={runCheck} disabled={check === "checking"}>{t("Rechercher une mise à jour")}</button>
        </Row>
      </Section>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <h2>{title}</h2>
      <div className="card settings__card">{children}</div>
    </section>
  );
}

export function Row({ label, desc, error = false, children }: { label: string; desc: string; error?: boolean; children: React.ReactNode }) {
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

export function Toggle({ on, onChange, disabled = false, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button className={`toggle${on ? " is-on" : ""}`} role="switch" aria-checked={on} aria-label={label}
            onClick={onChange} disabled={disabled}>
      <span className="toggle__knob" />
    </button>
  );
}

export function Choice<T extends string>({ value, onChange, options, disabled = [] }:
  { value: T; onChange: (v: T) => void; options: [T, string][]; disabled?: T[] }) {
  return (
    <Segmented className="segmented" role="radiogroup">
      {options.map(([k, label]) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? "is-active" : ""}
                disabled={disabled.includes(k)} title={disabled.includes(k) ? t("Bientôt disponible") : undefined}
                onClick={() => onChange(k)}>{label}</button>
      ))}
    </Segmented>
  );
}
