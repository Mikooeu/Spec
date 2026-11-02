# Spec

Trois briques pour l'instant :

1. **Le collecteur** (`collector/`) récupère en continu les parties classées solo des joueurs Master+ d'EUW et enregistre, pour chacune, le champion, le rôle, l'équipe et le résultat des 10 joueurs. Aucun pseudo n'est conservé.
2. **Le classement** (`scoring/`) agrège ces parties en stats et classe les champions de ton pool pour une draft donnée.
3. **L'appli Spec** (`app/`), en Tauri + React : lit la draft en direct dans le client LoL et affiche les recommandations, en grand ou en mode compact.
4. **Le serveur Oracle** (`infra/`) : le script qui crée la VM gratuite où tournera le collecteur 24 h/24.
5. **Le serveur Cloudflare** (`server/`) : distribue les stats Master+ à l'appli et calcule les stats perso de chaque ami inscrit.

Les commandes ci-dessous sont pour macOS (Terminal). Sous Windows, remplace `source venv/bin/activate` par `venv\Scripts\Activate.ps1`.

## Installation (une seule fois)

```bash
cd ~/Documents/Spec
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
open -e .env        # colle ta Personal API Key Riot, enregistre, ferme
```

## 1. Collecter

```bash
source venv/bin/activate
caffeinate -i python -m collector run
```

Laisse tourner (Mac branché, capot ouvert). `Ctrl+C` arrête proprement, la relance reprend où elle s'était arrêtée.

Avancement, dans un autre onglet (`Cmd+T`) pendant que la collecte tourne :

```bash
cd ~/Documents/Spec && source venv/bin/activate
python -m collector stats
```

Depuis la 0.2, chaque partie enregistre aussi les bans, les sorts d'invocateur et les objets de fin de partie. Pour 1 partie sur 3, le collecteur télécharge en plus son déroulé (ordre des sorts et des achats) : un appel Riot de plus, d'où une collecte environ 25 % plus lente. Le banrate de la tier list et la page champion (0.3) s'appuient sur ces parties.

## 2. Construire les stats

À relancer de temps en temps (par exemple une fois par jour) pour profiter des nouvelles parties. Le collecteur peut continuer à tourner.

```bash
python -m scoring build
```

Le patch le plus récent est utilisé. Tant qu'il a moins de 20 000 parties, le patch précédent est ajouté à 50 %.

Depuis la 0.1.1, le collecteur enregistre aussi la page de runes de chaque joueur (relance-le pour en profiter). `build` en tire la meilleure page par champion et par rôle, choix après choix (rune clé, runes mineures, arbre secondaire, fragments), et une autre rune clé face à un vis-à-vis quand elle y fait nettement mieux sur assez de parties.

## 3. Obtenir un classement

```bash
python -m scoring recommend --role mid \
  --pool "Ahri, Orianna, Viktor" \
  --allies "Darius, Vi, Jinx" \
  --enemies "Sylas, Lee Sin, Syndra, Nautilus"
```

- `--role` : top, jungle, mid, adc ou support
- `--pool` : tes champions pour ce rôle
- `--allies` / `--enemies` : les picks visibles (facultatifs)
- `--bans` : les champions bannis (facultatif)

Les noms sont tolérants : `lee sin`, `LeeSin`, `kaisa` ou `wukong` fonctionnent.

Pour chaque champion, le résultat affiche le score (winrate estimé dans cette draft) et son détail : winrate de base, effet du vis-à-vis probable, des autres ennemis et des alliés, et le nombre de parties. Un « ⚠ peu de données » signale un score encore fragile.

## 4. Calibrer le score

À lancer quand la base contient au moins 20 000 parties sur le patch (soit environ 2 000 mises de côté pour le test) :

```bash
python -m scoring calibrate
python -m scoring build
```

Le calibrage met de côté 10 % des parties, calcule les stats sur les 90 % restantes et vérifie, sur les parties mises de côté, si le score prédit mieux la victoire que le winrate de base seul. Il teste plusieurs réglages (α, β et lissage k) et enregistre le meilleur dans `data/params.json`, que `recommend` utilise ensuite automatiquement.

Lecture du résultat :
- **log loss** et **Brier** : plus c'est bas, mieux le score prédit.
- **précision** : part des victoires correctement prédites. Une petite amélioration (quelques points) est normale : une draft ne décide qu'une partie du résultat.

Avec trop peu de parties, les réglages ne sont pas enregistrés (option `--force` pour passer outre).

## 5. Lancer l'appli Spec

Première fois, dans le dossier `app` :

```bash
cd ~/Documents/Spec/app
npm install @fontsource/inter
node scripts/configure-spec.mjs
```

À chaque fois (depuis le dossier `Spec`) :

```bash
python -m scoring build
python -m scoring export          # écrit app/public/stats.json
cd app && npm run tauri dev
```

Le patch est affiché avec son numéro public (26.21), celui des notes de patch. Les données Riot gardent l'ancienne numérotation (16.21) : Spec ajoute 10 à l'affichage.

### Draft en direct

Lance le client LoL : l'écran d'attente affiche « Connecté » et ton compte. Dès la sélection des champions, Spec lit les picks alliés et adverses, les bans et ton rôle, une fois par seconde.

- **Présélectionner dans le client** survole le champion choisi. Spec ne verrouille jamais un pick : c'est toujours toi qui valides.
- En partie personnalisée, le client n'assigne pas de rôle : choisis-le avec le sélecteur en haut.
- Pour tester sans attendre une classée : partie personnalisée contre des bots.

Sans client LoL, **Simuler une draft** montre une draft fictive : clique sur un emplacement pour changer un pick. Ton pool se règle dans **Profil et pool** et reste enregistré.

### Mode compact

Bouton **Mode compact** en bas de la barre latérale ou en haut de la draft : une fenêtre de 400 × 720 qui reste au premier plan, à côté du client. L'épingle active ou coupe le premier plan, les flèches remettent la fenêtre en grand. Spec se rouvre dans le dernier mode utilisé.

Les icônes des champions sont chargées depuis Data Dragon, le CDN officiel de Riot.

## 6. Créer le serveur Oracle (gratuit)

Le collecteur doit tourner 24 h/24 sur une VM Oracle Always Free (Ampere A1, 2 OCPU, 12 Go). Oracle manque souvent de place : le script réessaie jusqu'à en trouver.

Une seule fois, installe l'outil Oracle :

```bash
python3 -m venv ~/.oci-cli
~/.oci-cli/bin/pip install oci-cli
```

Puis crée une clé d'API : console Oracle → icône de profil → **My profile** → **Tokens and keys** → **Add API key** → **Generate API key pair** → **Download private key** → **Add**. Range la clé et la configuration :

```bash
mkdir -p ~/.oci
mv ~/Downloads/*.pem ~/.oci/oci_api_key.pem
# colle dans ~/.oci/config le texte de « View configuration file » (··· sur la ligne de la clé),
# avec key_file=~/.oci/oci_api_key.pem
chmod 600 ~/.oci/config ~/.oci/oci_api_key.pem
```

Lance le script (Mac branché, écran ouvert) :

```bash
cd ~/Documents/Spec
caffeinate -i ./infra/oracle-retry.sh
```

Il essaie toutes les 60 s et passe d'une zone à l'autre. Quand une place se libère, il crée la VM (Ubuntu 24.04, réseau `draft-coach-vcn`), envoie une notification avec l'adresse IP et s'arrête. Il refuse de créer une deuxième VM. La clé SSH de connexion est créée dans `~/.ssh/spec_oracle`.

Si les VM Ampere restent introuvables, la petite VM AMD gratuite (1 Go) est presque toujours disponible :

```bash
TYPE=micro ./infra/oracle-retry.sh
```

Puis installe Spec dessus (collecteur 24 h/24 et stats envoyées toutes les 6 h), après avoir arrêté le collecteur du Mac :

```bash
./infra/deploy.sh <adresse IP de la VM>
```

Le script copie `.env` et la base de parties du Mac la première fois, puis lance deux services : `spec-collector` (redémarre tout seul) et `spec-stats.timer`. Sur 1 Go, le calcul des stats est plafonné à 500 Mo de mémoire et s'appuie sur 2 Go de swap : il est plus lent, mais tourne.

## 7. Serveur Cloudflare (gratuit)

Il sert les stats Master+ à l'appli et calcule les stats perso de la saison (winrate par champion, bilan par vis-à-vis) pour chaque ami inscrit. La clé Riot y est stockée comme secret : elle n'est jamais dans l'appli.

Une seule fois :

```bash
cd ~/Documents/Spec/server
npm install
npx wrangler login          # ouvre le navigateur pour autoriser Wrangler
npm run setup               # crée la base, déploie, enregistre les secrets
```

`npm run setup` affiche l'adresse du serveur et le **code d'invitation** à donner à tes amis. Il écrit `SPEC_API_URL`, `SPEC_ADMIN_TOKEN` et `SPEC_INVITE_CODE` dans `.env`, et l'adresse dans `app/.env.local`. Il peut être relancé sans risque.

Publier les stats Master+ (après chaque `build`) :

```bash
cd ~/Documents/Spec
python -m scoring export --upload
```

Stats perso : dans **Profil et pool**, entre le code d'invitation puis **Activer**. Le serveur analyse les parties classées de la saison (depuis le 8 janvier 2026) au rythme d'environ 14 par minute, puis les nouvelles parties toutes les 20 minutes. **Préremplir** ajoute ensuite tes champions les plus joués à ton pool.

Budget Riot : la clé autorise 100 appels toutes les 2 minutes sur match-v5. Le collecteur en garde 65 (`RIOT_REGION_LIMIT_2MIN` dans `.env`) et le serveur 28.

Commandes utiles (dans `server/`) : `npm run logs` (journal en direct), `npm test` (tests), `npm run deploy` (redéployer après une modification).

Administration (dans `server/`) :
- `npm run admin -- list` : joueurs inscrits (sans pseudo) et avancement de la synchro.
- `npm run admin -- add-device "Nom#TAG"` : autorise un PC de plus pour ce compte pendant 15 minutes, une seule fois. Le joueur entre ensuite le code d'invitation sur son nouveau PC.
- `npm run admin -- unlink "Nom#TAG"` : délie un compte de tous ses PC, ses stats restent. À utiliser si quelqu'un s'est inscrit à la place d'un ami. Un compte déjà lié n'accepte jamais un nouveau PC sans `add-device`.

## 8. Version Windows et mises à jour

GitHub construit le fichier d'installation Windows sur ses machines, gratuitement, et le publie dans les **Releases** du dépôt. L'appli vérifie les nouvelles versions au lancement et toutes les 6 h, et propose « Installer et redémarrer ». Les mises à jour sont signées : l'appli refuse tout fichier qui n'a pas été signé avec ta clé.

Une seule fois :

1. Clé de signature, dans `app` : `npx tauri signer generate -w ~/.tauri/spec.key` (choisis un mot de passe). La clé privée reste dans `~/.tauri/`, hors du dossier Spec.
2. GitHub Desktop : File → Add Local Repository → `Documents/Spec` → create a repository, puis Publish repository en décochant « Keep this code private ». Avant de publier, vérifie qu'aucun `.env`, `.pem` ou dossier `data`/`venv` n'apparaît dans la liste.
3. Dans `app` : `node scripts/configure-release.mjs` (lit le dépôt et la clé publique), puis commit + push dans GitHub Desktop.
4. Sur github.com, dans le dépôt : Settings → Secrets and variables → Actions :
   - Secrets : `TAURI_SIGNING_PRIVATE_KEY` (contenu de `~/.tauri/spec.key`, copié avec `pbcopy < ~/.tauri/spec.key`) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   - Variables : `SPEC_API_URL` (l'adresse du serveur Cloudflare).

À chaque nouvelle version :

1. Dans `app` : `node scripts/configure-release.mjs 0.2.0` (nouveau numéro), puis commit + push.
2. Sur github.com : Actions → Version Windows → Run workflow. Compte 10 à 15 minutes.
3. Releases : relis le brouillon, puis **Publish release**. Les applis installées le verront dans les 6 h.

Windows peut afficher « Windows a protégé votre ordinateur » au premier lancement de l'installateur, car il n'est pas signé avec un certificat payant : « Informations complémentaires » → « Exécuter quand même ».

## Vérifier que tout fonctionne

```bash
python -m pytest -q
```

## Sécurité

- La clé Riot vit uniquement dans `.env`, exclu de Git. Ne la colle jamais dans le code ni dans une conversation. Elle reste sur le serveur : elle n'est jamais livrée dans l'appli.
- La clé d'API Oracle (`~/.oci/oci_api_key.pem`) et la clé SSH (`~/.ssh/spec_oracle`) restent hors du dossier Spec. Ne les partage jamais.
- L'appli ne parle qu'au client LoL de ta machine (127.0.0.1), sur une liste fermée d'adresses. Elle n'affiche aucun pseudo d'autre joueur et ne verrouille jamais un pick.
- Le serveur Cloudflare garde la clé Riot, le jeton admin et le code d'invitation comme secrets. Seul le cron interroge Riot : les requêtes de l'appli ne consomment jamais le budget de la clé. Il ne stocke aucun pseudo, seulement le PUUID et les champions joués.
- Les données (`data/`) sont aussi exclues de Git.

## Structure

| Fichier | Rôle |
| --- | --- |
| `collector/ratelimit.py` | Respect des limites Riot (20/s, 100/2 min) |
| `collector/riot.py` | Appels à l'API Riot (league-v4, match-v5) |
| `collector/db.py` | Base DuckDB `data/draft.duckdb`, partageable pendant la collecte |
| `collector/collect.py` | Ladder → parties à télécharger → détail des parties |
| `scoring/champions.py` | Noms des champions via Data Dragon |
| `scoring/build.py` | Agrégation : base, rôles, vis-à-vis, counters, synergies → `data/stats.duckdb` |
| `scoring/score.py` | Formule du score de la spec, avec lissage |
| `scoring/export.py` | Export des stats pour l'appli → `app/public/stats.json` |
| `app/src-tauri/src/lcu.rs` | Connexion au client LoL : lecture de la draft, présélection |
| `app/src/lib/lcu.ts` | Draft en direct côté interface |
| `app/src/lib/score.ts` | Même formule de score que `scoring/score.py`, dans l'appli |
| `app/src/components/` | Écrans : draft, mode compact, profil et pool |
| `.github/workflows/release.yml` | Construction Windows et publication des versions |
| `app/scripts/configure-release.mjs` | Version, dépôt et clé publique des mises à jour |
| `infra/oracle-retry.sh` | Création de la VM Oracle, avec nouvel essai automatique |
| `server/src/` | Serveur Cloudflare : routes, synchro des stats perso |
| `server/scripts/setup.mjs` | Installation du serveur en une commande |
| `scoring/upload.py` | Envoi des stats Master+ au serveur |
| `tests/` | Tests automatiques |
