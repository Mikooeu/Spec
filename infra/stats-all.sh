#!/usr/bin/env bash
# Calcule et envoie les stats de chaque région (EUW, KR, NA), puis « World » qui les réunit.
# Lancé toutes les 6 h par le service spec-stats sur la VM. Une région sans parties est sautée.
cd "$(dirname "$0")/.." || exit 1
status=0
for region in euw kr na world; do
  if venv/bin/python -m scoring build --region "$region" && venv/bin/python -m scoring export --region "$region" --upload; then
    echo "✓ $region"
  else
    echo "✗ $region (voir les lignes au-dessus)"
    [ "$region" = euw ] && status=1    # seule l'EUW est indispensable
  fi
done
exit $status
