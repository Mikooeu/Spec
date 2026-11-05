-- Les requêtes de duo (parties jouées ensemble, `with=`) cherchent les autres joueurs d'une même partie
-- par match_id. Sans cet index, D1 relisait toute la table pour chaque partie (des millions de lignes lues
-- par appel, au-delà du quota gratuit de 5 millions par jour).
CREATE INDEX IF NOT EXISTS player_matches_match ON player_matches (match_id);
