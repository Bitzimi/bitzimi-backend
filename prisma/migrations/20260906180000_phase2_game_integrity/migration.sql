-- Phase 2 game integrity: durable concurrency guards and dice-round player invariants.
CREATE UNIQUE INDEX IF NOT EXISTS matchmaking_waiting_user_game_stake_uq
  ON matchmaking_queues (user_id, game_type, stake)
  WHERE status = 'waiting';

CREATE UNIQUE INDEX IF NOT EXISTS dice_round_one_active_per_game_stake_uq
  ON dice_rounds (game_type, stake)
  WHERE status IN ('open','countdown','locked','rolling');

CREATE UNIQUE INDEX IF NOT EXISTS game_bet_round_user_uq
  ON game_bets (round_id, user_id);

CREATE OR REPLACE FUNCTION bitzimi_merge_dice_players()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merged jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(value ORDER BY ord), '[]'::jsonb)
    INTO merged
    FROM (
      SELECT value, min(ord) AS ord
      FROM (
        SELECT value, ord FROM jsonb_array_elements_text(COALESCE(OLD.player_ids::jsonb, '[]'::jsonb)) WITH ORDINALITY
        UNION ALL
        SELECT value, 1000000 + ord FROM jsonb_array_elements_text(COALESCE(NEW.player_ids::jsonb, '[]'::jsonb)) WITH ORDINALITY
      ) u
      GROUP BY value
    ) d;
  IF jsonb_array_length(merged) > NEW.max_players THEN
    RAISE EXCEPTION 'DICE_ROUND_FULL';
  END IF;
  NEW.player_ids := merged::text;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS dice_round_player_merge ON dice_rounds;
CREATE TRIGGER dice_round_player_merge
BEFORE UPDATE OF player_ids ON dice_rounds
FOR EACH ROW EXECUTE FUNCTION bitzimi_merge_dice_players();
