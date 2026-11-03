-- Détail de chaque partie d'un joueur inscrit, pour l'historique de l'appli (tableau JSON compact :
-- durée, K, D, A, CS, or, dégâts, 8 objets (dont celui de la quête de rôle), 2 sorts, rune clé, arbre secondaire). Aucun pseudo.
ALTER TABLE player_matches ADD COLUMN detail TEXT;
CREATE INDEX player_matches_recent ON player_matches (puuid, game_creation);
-- les parties déjà enregistrées sont relues une fois pour remplir leur détail (les plus récentes d'abord)
INSERT OR IGNORE INTO pending (puuid, match_id) SELECT puuid, match_id FROM player_matches WHERE detail IS NULL;
