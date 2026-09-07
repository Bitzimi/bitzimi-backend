-- Durable server-side presence for Color Prediction lobbies.
-- Presence expires automatically through last_seen_at; no client-local count is authoritative.
CREATE TABLE IF NOT EXISTS color_lobby_presences (
    id TEXT NOT NULL,
    lobby_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT color_lobby_presences_pkey PRIMARY KEY (id),
    CONSTRAINT color_lobby_presences_lobby_user_key UNIQUE (lobby_id, user_id),
    CONSTRAINT color_lobby_presences_user_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS color_lobby_presences_lobby_seen_idx
    ON color_lobby_presences (lobby_id, last_seen_at);
