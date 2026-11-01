-- Plusieurs appareils par compte : chaque PC (identifiant du client LoL, haché) pointe vers un joueur.
CREATE TABLE devices (
  client_hash TEXT PRIMARY KEY,
  puuid TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX devices_puuid ON devices (puuid);
INSERT INTO devices (client_hash, puuid, created_at)
  SELECT client_hash, puuid, created_at FROM players WHERE client_hash IS NOT NULL;
-- fenêtre ouverte par l'admin pour ajouter un appareil à un compte déjà lié (ms)
ALTER TABLE players ADD COLUMN device_window_until INTEGER;
