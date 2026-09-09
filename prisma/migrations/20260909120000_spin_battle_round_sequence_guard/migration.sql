-- Spin Battle round integrity guard.
-- Round numbers are scoped to each Spin Battle lobby. A round that is currently
-- active must be the latest round number for that lobby, and two active rounds
-- may never be created with the same number.

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

    -- If a completed round with no bets sits ahead of the current active round,
    -- it is an orphan created by a previous race during round creation. It was
    -- never a playable round, so keep the row for auditability but exclude it
    -- from the recent-winner stream.
    IF active_round IS NOT NULL THEN
      UPDATE game_round r
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

-- Prevent duplicate round numbers for Spin Battle within a lobby once the
-- historical orphan rows above have been neutralized. This is deliberately
-- scoped to Spin Battle so other game round numbering remains untouched.
CREATE UNIQUE INDEX IF NOT EXISTS game_rounds_spin_battle_lobby_round_unique
  ON game_rounds (lobby_id, round_number)
  WHERE game_type = 'spin_battle';
