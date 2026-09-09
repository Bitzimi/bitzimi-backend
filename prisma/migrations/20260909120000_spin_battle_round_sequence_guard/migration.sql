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
    FROM game_rounds
    WHERE game_type = 'spin_battle'
      AND lobby_id IS NOT NULL
  LOOP
    SELECT MAX(round_number)
      INTO active_round
    FROM game_rounds
    WHERE game_type = 'spin_battle'
      AND lobby_id = lobby
      AND status IN ('waiting','countdown','locked','spinning','result');

    IF active_round IS NOT NULL THEN
      UPDATE game_rounds r
      SET status = 'cancelled'
      WHERE r.game_type = 'spin_battle'
        AND r.lobby_id = lobby
        AND r.status = 'completed'
        AND r.round_number > active_round
        AND NOT EXISTS (
          SELECT 1 FROM game_bets b WHERE b.round_id = r.id
        );
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS game_rounds_spin_battle_lobby_round_unique
  ON game_rounds (lobby_id, round_number)
  WHERE game_type = 'spin_battle';
