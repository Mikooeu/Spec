-- Joueurs inscrits (amis) : uniquement le PUUID, aucun pseudo.
CREATE TABLE players (
  puuid TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ids_cursor INTEGER,            -- reprise de l'historique complet (offset), NULL = à jour
  ids_refreshed_at INTEGER,      -- dernière lecture de la liste des parties (ms)
  last_seen_at INTEGER NOT NULL  -- dernière consultation par l'appli (ms)
);

-- Parties à télécharger pour un joueur.
CREATE TABLE pending (
  puuid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  PRIMARY KEY (puuid, match_id)
);
CREATE INDEX pending_match ON pending (match_id);

-- Une ligne par partie classée solo d'un joueur inscrit.
CREATE TABLE player_matches (
  puuid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  game_creation INTEGER NOT NULL,
  champion_id INTEGER NOT NULL,
  role INTEGER NOT NULL,         -- 0 top, 1 jungle, 2 mid, 3 adc, 4 support, -1 inconnu
  opponent_id INTEGER,           -- champion adverse sur la même ligne
  win INTEGER NOT NULL,
  remake INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (puuid, match_id)
);
