-- Game transaction history is authoritative only after a game result exists.
-- Remove legacy entry/bet ledger rows created before settlement for the affected games.
DELETE FROM "transactions" t
WHERE t.type = 'game_bet'
  AND t.reference_type IN ('pvp_match', 'game_round')
  AND (
    t.reference_type = 'pvp_match'
    OR EXISTS (
      SELECT 1
      FROM "game_bets" gb
      JOIN "game_rounds" gr ON gr.id = gb.round_id
      WHERE gb.id = t.reference_id
        AND gr.game_type IN ('dice_royale', 'dice_arena', 'spin_battle', 'color_game')
    )
  );

-- Focused index for the hot public matchmaking query.
CREATE INDEX IF NOT EXISTS "matchmaking_queues_game_stake_status_created_idx"
  ON "matchmaking_queues" ("game_type", "stake", "status", "created_at");
