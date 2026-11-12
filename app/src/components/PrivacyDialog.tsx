import { useEffect } from "react";
import { t } from "../lib/i18n";

/** Texte complet demandé par Riot pour les produits tiers (« Legal Jibber Jabber »). */
export const RIOT_LEGAL = "Spec isn’t endorsed by Riot Games and doesn’t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

/** Adresse de contact affichée dans la page de confidentialité (vide : ligne masquée). */
export const PRIVACY_CONTACT = "";

/** Page de confidentialité : ce que Spec lit, ce qu'il envoie, ce qu'il garde, et comment tout supprimer. */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const sections: [string, string[]][] = [
    [t("Ce que Spec lit sur ton PC"), [
      t("Ton compte, ta sélection des champions et ta partie en cours, lus dans le client League of Legends et dans le jeu. Ces données restent sur ton PC."),
      t("Ton champion pool, tes réglages et ta courbe de LP sont enregistrés sur ton PC uniquement."),
    ]],
    [t("Ce qui est envoyé au serveur Spec"), [
      t("Seulement si tu actives les stats perso : l’identifiant de ton compte Riot (PUUID), qui sert à récupérer tes parties classées de la saison auprès de Riot."),
      t("Pour chaque partie : champion, rôle, vis-à-vis, résultat et statistiques de la partie. C’est ce qui calcule ton winrate perso, tes stats et tes duos."),
      t("Ton pseudo n’est jamais enregistré, ni ton mot de passe, ni tes messages."),
    ]],
    [t("Où et combien de temps"), [
      t("Les données sont hébergées chez Cloudflare. Elles sont gardées tant que ton compte est lié à Spec."),
      t("Les stats Master+ (tier list, recommandations) viennent de parties anonymes : aucun joueur n’y est identifiable."),
    ]],
    [t("Tes droits"), [
      t("Tu peux tout supprimer à tout moment : Réglages › Supprimer mes données. Ton compte, tes appareils et tes parties sont effacés du serveur tout de suite."),
      ...(PRIVACY_CONTACT ? [t("Pour toute question sur tes données : {c}", { c: PRIVACY_CONTACT })] : []),
    ]],
  ];
  return (
    <div className="grecap-modal privacy" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onClick={onClose}>
      <div className="card privacy__box" onClick={(e) => e.stopPropagation()}>
        <div className="privacy__head">
          <h2 id="privacy-title">{t("Confidentialité")}</h2>
          <button className="btn btn--secondary btn--small" onClick={onClose} autoFocus>{t("Fermer")}</button>
        </div>
        {sections.map(([title, lines]) => (
          <section key={title} className="privacy__section">
            <h3>{title}</h3>
            {lines.map((l) => <p key={l}>{l}</p>)}
          </section>
        ))}
        <section className="privacy__section">
          <h3>{t("Mentions légales")}</h3>
          <p lang="en">{RIOT_LEGAL}</p>
        </section>
      </div>
    </div>
  );
}
