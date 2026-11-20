# Spec — notes pour Claude

Spec est une appli desktop qui lit la draft League of Legends dans le client et recommande le meilleur pick par rôle (winrates Master+, stats perso du joueur), avec bans suggérés, tier list, page champion, profil et récap de partie. Une quinzaine d'amis l'utilisent. C'est aussi l'étude de cas principale du portfolio de Théo (designer UX/UI et Product).

Réponds en français. Parle simplement : Théo est designer, pas développeur.

## Structure du dépôt
- `app/` : l'appli Tauri (React + TypeScript). `app/src-tauri/src/` : le Rust (`lib.rs`, `lcu.rs` pour la connexion au client LoL, fenêtres overlay).
- `scoring/` : collecte des parties Master+ et calcul des stats (Python, `python -m scoring …`).
- `server/` : Worker Cloudflare + base D1 (stats Master+, stats perso des amis inscrits, code d'invitation). Commandes dans `server/` : `npm run logs`, `npm test`, `npm run deploy`.
- `infra/` : scripts de la VM Oracle Always Free AMD 1 Go (`oracle-retry.sh`, `deploy.sh`). Services `spec-collector` et `spec-stats.timer`.
- `.env`, `data/` : jamais dans Git.

Vérifie ces chemins sur le dépôt avant de t'y fier : ce fichier peut être en retard sur le code.

## Livrer une mise à jour
- Théo travaille sur Mac (Terminal zsh). Dépôt local : `~/Documents/Spec`.
- Livre toujours un zip du dossier complet `spec-X.Y.Z` (pas seulement les fichiers modifiés), plus la commande pour l'intégrer :
  ```
  cd ~/Documents/Spec && rsync -a --exclude .git --exclude node_modules --exclude target ~/Desktop/spec-X.Y.Z/ ./ && git add -A && git commit -m "X.Y.Z"
  ```
  Puis Push origin dans GitHub Desktop et l'action GitHub « Version Windows ».
- Incrémente la version partout (Tauri, package.json, titre de fenêtre « Spec VX.Y.Z »).
- Lance les tests et le typage avant de livrer. Dis clairement ce que tu n'as pas pu tester (l'appli Tauri complète tourne seulement chez Théo).
- Notes de version GitHub : avec un titre (elles sont reprises par le site).
- Patch notes Discord, en Markdown brut et sans emoji :
  ```
  **Spec X.Y.Z**
  - **mot clé** : description courte
  ```

## Règles produit et UI
- Maquettes dans Figma (fichier `zd8CShkgqYHNrQtPaBolNa`, pages « refonte » et « tuto »). Théo modifie parfois les écrans lui-même : avant de coder un écran, vérifie qu'il correspond à la version actuelle dans Figma.
- DA style Apple, UX fluide inspirée de DPM. Pas de petite phrase d'explication sous les titres des pages et menus.
- Garde la navbar en rail. Overlay reste une entrée à part, séparée de Pool par une petite barre avec Réglages.
- Bans proposés : toujours des champions du rôle du joueur, classés selon le matchup de son pick survolé, son équipe et l'équipe adverse.
- Overlay sur l'écran de chargement du jeu : en pause (retiré le 13 nov. 2026). N'y touche pas sans demande.
- Si une maquette contredit le fonctionnement réel de l'appli, garde le fonctionnement réel et signale l'écart.

## Sécurité et contraintes Riot
- Spec ne parle qu'au client LoL local, sur un minimum d'adresses. Il ne verrouille jamais un pick : c'est toujours le joueur qui valide.
- Aucun pseudo stocké ni affiché côté serveur : seulement le PUUID et les champions.
- La clé Riot reste un secret du serveur Cloudflare, jamais dans l'appli.
- Clé actuelle : clé personnelle. Demande de clé de production envoyée le 12 nov. 2026. Respecte le budget de requêtes (collecteur et serveur se le partagent, réglages dans `.env`).
- D1 gratuit : 5 millions de lignes lues par jour. Fais attention aux lectures quand tu touches au serveur.
- Hébergement 100 % gratuit : ne propose rien de payant sans le dire clairement.
- Mention obligatoire : Spec n'est pas approuvé par Riot Games.

## Façon de travailler
- Demande validation avant tout changement important (nouvelle fonction, refonte, suppression). Petites corrections demandées : fais-les directement.
- Contredis Théo s'il se trompe ou s'il y a une meilleure option.
- Utilise Claude Security pour les changements sensibles (serveur, connexion au client, données des joueurs).
- Ordre actuel : tests et correction de bugs, puis nouvelles idées. Refonte UI en cours par étapes : rail et barre du haut, menu de build et compact B, tier list et page champion, profil et récap, écran d'attente et tuto.
