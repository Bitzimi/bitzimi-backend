-- Spin Battle round integrity guard.
-- Round numbers are scoped to each Spin Battle lobby. A round that is currently
-- active must be the latest round number for that lobby, and duplicate numbers
-- must never be created for the same lobby.

DO $$
DECLARE
  lobby text;
  active_round integer;
BEGIN
  FOR lobby IN
    SELECT DISTINCT lobby_id
    FROM game_round
    WHERE game_type = 'spin_battle'
      AND lobby_id IS NOT NULL
  LOOP
    SELECT MAX(round_number)
      INTO active_round
    FROM game_round
    WHERE game_type = 'spin_battle'
      AND lobby_id = lobby
      AND status IN ('waiting','countdown','locked','spinning','result');

    -- A completed round ahead of the active round with no bets is an orphan
    -- created by the old race condition. Keep the row for auditability but
    -- prevent it from appearing as a recent winner.
    IF active_round IS NOT NULL THEN
      UPDATE game_round r
      SET status = 'cancelled'
      WHERE r.game_type = 'spin_battle'
        AND r.lobby_id = lobby
        AND r.status = 'completed'
        AND r.round_number > active_round
        AND NOT EXISTS (
          SELECT 1 FROM game_bet b WHERE b.round_id = r.id
        );
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS game_round_spin_battle_lobby_round_unique
  ON game_round (lobby_id, round_number)
  WHERE game_type = 'spin_battle';
