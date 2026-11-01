#!/usr/bin/env bash
# Spec : réessaie de créer la VM Oracle Always Free (Ampere A1) jusqu'à ce qu'une place se libère.
#
# Lancement (depuis le dossier Spec) :   caffeinate -i ./infra/oracle-retry.sh
# Arrêt : Ctrl+C. Le script ne contient aucun secret : il lit ~/.oci/config.
#
# Réglages facultatifs (variables d'environnement) :
#   WAIT=60  OCPUS=2  MEMORY=12  BOOT_GB=50  VCN_NAME=draft-coach-vcn  SSH_KEY=~/.ssh/spec_oracle

set -u

if [ -z "${OCI:-}" ]; then
  if [ -x "$HOME/.oci-cli/bin/oci" ]; then OCI="$HOME/.oci-cli/bin/oci"; else OCI="oci"; fi
fi
NAME="spec-collector"
SHAPE="VM.Standard.A1.Flex"
VCN_NAME="${VCN_NAME:-draft-coach-vcn}"
OCPUS="${OCPUS:-2}"
MEMORY="${MEMORY:-12}"
BOOT_GB="${BOOT_GB:-50}"
WAIT="${WAIT:-60}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/spec_oracle}"
CONFIG="${OCI_CONFIG:-$HOME/.oci/config}"

say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { say "Erreur : $*"; exit 1; }
first_ocid() { grep -oE 'ocid1\.[a-z0-9._-]*[a-z0-9]' | head -1; }
notify() { command -v osascript >/dev/null && osascript -e "display notification \"$1\" with title \"Spec\" sound name \"Glass\"" >/dev/null 2>&1; true; }

command -v "$OCI" >/dev/null 2>&1 || [ -x "$OCI" ] || die "la commande oci est introuvable. Installe-la (étape 1 du guide)."
[ -f "$CONFIG" ] || die "$CONFIG est introuvable. Ajoute ta clé d'API (étape 2 du guide)."

TENANCY=$(awk -F= '/^\[/{s=($0=="[DEFAULT]")} s && $1 ~ /^[ \t]*tenancy[ \t]*$/ {gsub(/[ \t\r]/,"",$2); print $2; exit}' "$CONFIG")
[ -n "$TENANCY" ] || die "pas de ligne tenancy=… dans la section [DEFAULT] de $CONFIG."

say "Connexion à Oracle…"
ADS_RAW=$("$OCI" iam availability-domain list --compartment-id "$TENANCY" --query 'data[].name' --raw-output 2>&1) \
  || die "Oracle refuse la connexion. Vérifie ~/.oci/config et la clé d'API.
$ADS_RAW"
ADS=$(printf '%s' "$ADS_RAW" | tr -d '[]", ' | grep -v '^$')
[ -n "$ADS" ] || die "aucun domaine de disponibilité trouvé."

# Ne jamais créer de doublon : une instance A1 gratuite suffit.
EXISTING=$("$OCI" compute instance list --compartment-id "$TENANCY" --display-name "$NAME" \
  --query 'data[?"lifecycle-state"!=`TERMINATED`].id' --raw-output 2>/dev/null | first_ocid)
[ -z "$EXISTING" ] || die "l'instance $NAME existe déjà ($EXISTING). Rien à faire."

VCN_ID=$("$OCI" network vcn list --compartment-id "$TENANCY" --display-name "$VCN_NAME" \
  --query 'data[0].id' --raw-output 2>/dev/null | first_ocid)
[ -n "$VCN_ID" ] || die "réseau $VCN_NAME introuvable."
SUBNET_ID=$("$OCI" network subnet list --compartment-id "$TENANCY" --vcn-id "$VCN_ID" \
  --query 'data[?"prohibit-public-ip-on-vnic"==`false`].id' --raw-output 2>/dev/null | first_ocid)
[ -n "$SUBNET_ID" ] || die "aucun sous-réseau public dans $VCN_NAME."

IMAGE_ID=$("$OCI" compute image list --compartment-id "$TENANCY" --operating-system "Canonical Ubuntu" \
  --operating-system-version "24.04" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output 2>/dev/null | first_ocid)
[ -n "$IMAGE_ID" ] || die "image Ubuntu 24.04 ARM introuvable."

if [ ! -f "$SSH_KEY.pub" ]; then
  say "Création d'une clé SSH dans $SSH_KEY (elle reste sur ton Mac)."
  mkdir -p "$(dirname "$SSH_KEY")"
  ssh-keygen -q -t rsa -b 4096 -N "" -C "spec-oracle" -f "$SSH_KEY" || die "impossible de créer la clé SSH."
fi

say "Prêt : $OCPUS OCPU, $MEMORY Go, Ubuntu 24.04, essai toutes les ${WAIT} s. Ctrl+C pour arrêter."

try=0
while :; do
  for AD in $ADS; do
    try=$((try + 1))
    ad_short=${AD##*-}
    OUT=$("$OCI" compute instance launch \
      --availability-domain "$AD" --compartment-id "$TENANCY" --display-name "$NAME" \
      --shape "$SHAPE" --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY}" \
      --image-id "$IMAGE_ID" --subnet-id "$SUBNET_ID" --assign-public-ip true \
      --boot-volume-size-in-gbs "$BOOT_GB" --ssh-authorized-keys-file "$SSH_KEY.pub" 2>&1)
    CODE=$?

    if [ $CODE -eq 0 ]; then
      INSTANCE_ID=$(printf '%s' "$OUT" | grep -oE 'ocid1\.instance\.[a-z0-9._-]*[a-z0-9]' | head -1)
      say "Place trouvée à l'essai $try ! Démarrage de la VM…"
      notify "VM Oracle créée, démarrage en cours"
      "$OCI" compute instance get --instance-id "$INSTANCE_ID" --wait-for-state RUNNING \
        --max-wait-seconds 900 >/dev/null 2>&1
      IP=$("$OCI" compute instance list-vnics --instance-id "$INSTANCE_ID" \
        --query 'data[0]."public-ip"' --raw-output 2>/dev/null | tr -d '"[:space:]')
      say "VM prête. Adresse IP publique : ${IP:-à lire dans la console Oracle}"
      say "Connexion : ssh -i $SSH_KEY ubuntu@${IP:-<IP>}"
      notify "VM Oracle prête : ${IP:-voir la console}"
      exit 0
    fi

    case "$OUT" in
      *"ut of host capacity"*|*"ut of capacity"*)
        say "Essai $try (domaine $ad_short) : pas de place, nouvel essai dans ${WAIT} s." ;;
      *TooManyRequests*|*'"status": 429'*)
        say "Essai $try : Oracle demande de ralentir, pause de 5 min."; sleep 300 ;;
      *LimitExceeded*|*QuotaExceeded*)
        die "limite gratuite atteinte : une autre instance A1 utilise peut-être déjà les ressources.
$OUT" ;;
      *NotAuthenticated*|*NotAuthorized*|*"401"*)
        die "Oracle refuse la connexion. Vérifie ~/.oci/config et la clé d'API." ;;
      *)
        say "Essai $try : réponse inattendue d'Oracle, on continue :"
        printf '%s\n' "$OUT" | grep -E '"(code|message)"' | head -2 ;;
    esac
    sleep "$WAIT"
  done
done
