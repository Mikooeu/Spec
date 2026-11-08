-- 0.5 : côté, fin par abandon et pentakills ajoutés au détail de chaque partie (page Stats).
-- Les parties déjà enregistrées sont relues une fois pour les remplir (les plus récentes d'abord, comme en 0004).
INSERT OR IGNORE INTO pending (puuid, match_id)
  SELECT puuid, match_id FROM player_matches WHERE detail IS NOT NULL AND json_array_length(detail) < 14;
