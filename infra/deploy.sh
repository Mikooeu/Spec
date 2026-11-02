#!/usr/bin/env bash
# Spec : installe le collecteur et la mise à jour automatique des stats sur la VM Oracle.
#
# Lancement (depuis le dossier Spec, sur le Mac) :   ./infra/deploy.sh <adresse IP de la VM>
# À relancer sans risque : il met à jour le code et redémarre les services.
#
# Ce qu'il fait :
#   1. sur la VM : Python, 2 Go de mémoire d'appoint (swap), code Spec depuis GitHub, environnement Python ;
#   2. copie .env (clé Riot, accès au serveur Spec) et la base de parties du Mac vers la VM (1re fois seulement) ;
#   3. lance deux services : le collecteur (redémarré tout seul en cas d'erreur ou de redémarrage de la VM)
#      et le calcul + l'envoi des stats toutes les 6 h.
# La clé Riot ne quitte le Mac que vers ta VM, par SSH ; elle n'est jamais mise sur GitHub.

set -euo pipefail

IP="${1:-}"
KEY="${SSH_KEY:-$HOME/.ssh/spec_oracle}"
[ -n "$IP" ] || { echo "Usage : ./infra/deploy.sh <adresse IP de la VM>"; exit 1; }
[ -f "$KEY" ] || { echo "Clé SSH introuvable : $KEY"; exit 1; }
[ -f .env ] || { echo "Lance ce script depuis le dossier Spec (fichier .env introuvable)."; exit 1; }

REMOTE=$(sed -n 's/^[[:space:]]*url[[:space:]]*=[[:space:]]*//p' .git/config 2>/dev/null | head -1)
REPO=$(printf '%s' "$REMOTE" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')
[ -n "$REPO" ] || { echo "Dépôt GitHub introuvable dans .git/config."; exit 1; }

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$IP")
say() { printf '\n▸ %s\n' "$*"; }

say "Installation sur la VM ($IP), dépôt github.com/$REPO…"
"${SSH[@]}" "REPO='$REPO' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv git >/dev/null
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
if [ -d ~/Spec/.git ]; then git -C ~/Spec pull -q; else git clone -q "https://github.com/$REPO.git" ~/Spec; fi
cd ~/Spec
[ -d venv ] || python3 -m venv venv
venv/bin/pip install -q -r requirements.txt
mkdir -p data

sudo tee /etc/systemd/system/spec-collector.service >/dev/null <<'UNIT'
[Unit]
Description=Spec - collecteur de parties Master+
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Spec
ExecStart=/home/ubuntu/Spec/venv/bin/python -m collector run
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/spec-stats.service >/dev/null <<'UNIT'
[Unit]
Description=Spec - calcul et envoi des stats

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/Spec
Environment=DUCKDB_MEMORY_LIMIT=500MB
ExecStart=/bin/bash -c 'venv/bin/python -m scoring build && venv/bin/python -m scoring export --upload'
UNIT

sudo tee /etc/systemd/system/spec-stats.timer >/dev/null <<'UNIT'
[Unit]
Description=Spec - stats toutes les 6 h

[Timer]
OnBootSec=20min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
REMOTE_SCRIPT

if ! "${SSH[@]}" test -f Spec/.env; then
  say "Copie de .env vers la VM…"
  scp -q -i "$KEY" .env "ubuntu@$IP:Spec/.env"
  "${SSH[@]}" chmod 600 Spec/.env
fi

if ! "${SSH[@]}" test -f Spec/data/draft.duckdb && [ -f data/draft.duckdb ]; then
  if pgrep -f "collector run" >/dev/null || pgrep -f "scoring build" >/dev/null; then
    echo "Arrête d'abord le collecteur et la boucle des stats sur le Mac (Ctrl+C dans leurs onglets), puis relance ce script."
    exit 1
  fi
  say "Copie de la base de parties ($(du -h data/draft.duckdb | cut -f1)), ça peut prendre quelques minutes…"
  scp -q -i "$KEY" data/draft.duckdb "ubuntu@$IP:Spec/data/draft.duckdb"
  [ -f data/params.json ] && scp -q -i "$KEY" data/params.json "ubuntu@$IP:Spec/data/params.json"
fi

say "Démarrage des services…"
"${SSH[@]}" "sudo systemctl enable --now spec-collector spec-stats.timer >/dev/null 2>&1 && sudo systemctl restart spec-collector"
sleep 5
"${SSH[@]}" "systemctl is-active spec-collector >/dev/null && echo '✓ Collecteur en route' || echo '✗ Le collecteur ne démarre pas : journalctl -u spec-collector -n 30'"
cat <<EOM

C'est en place. Le collecteur tourne 24 h/24 sur la VM et les stats partent au serveur toutes les 6 h.
Tu peux fermer les onglets du collecteur et des stats sur le Mac.

Suivre le collecteur :       ssh -i $KEY ubuntu@$IP "journalctl -u spec-collector -f"
Avancement de la collecte :  ssh -i $KEY ubuntu@$IP "cd Spec && venv/bin/python -m collector stats"
Stats tout de suite :        ssh -i $KEY ubuntu@$IP "sudo systemctl start spec-stats"
EOM
