-- Lien entre l'identifiant du client LoL (haché) et le PUUID de l'API Riot.
ALTER TABLE players ADD COLUMN client_hash TEXT;
CREATE UNIQUE INDEX players_client ON players (client_hash);
