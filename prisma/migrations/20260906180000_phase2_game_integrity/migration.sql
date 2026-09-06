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

-- Financial settlement rows are immutable after settlement. This makes a concurrent
-- settlement transaction roll back after the first transaction has committed.
CREATE OR REPLACE FUNCTION bitzimi_block_settled_game_bet_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settled THEN
    RAISE EXCEPTION 'GAME_BET_ALREADY_SETTLED';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS game_bet_settlement_guard ON game_bets;
CREATE TRIGGER game_bet_settlement_guard
BEFORE UPDATE ON game_bets
FOR EACH ROW EXECUTE FUNCTION bitzimi_block_settled_game_bet_mutation();

CREATE OR REPLACE FUNCTION bitzimi_block_finalized_pvp_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'PVP_MATCH_ALREADY_FINAL';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS pvp_match_finalization_guard ON pvp_matches;
CREATE TRIGGER pvp_match_finalization_guard
BEFORE UPDATE ON pvp_matches
FOR EACH ROW EXECUTE FUNCTION bitzimi_block_finalized_pvp_mutation();

CREATE OR REPLACE FUNCTION bitzimi_block_finalized_dice_round_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('result','completed','cancelled') THEN
    RAISE EXCEPTION 'DICE_ROUND_ALREADY_FINAL';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS dice_round_finalization_guard ON dice_rounds;
CREATE TRIGGER dice_round_finalization_guard
BEFORE UPDATE ON dice_rounds
FOR EACH ROW EXECUTE FUNCTION bitzimi_block_finalized_dice_round_mutation();
