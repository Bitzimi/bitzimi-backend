import { db } from "../../../db";
import { randomUUID } from "node:crypto";

const PRESENCE_TTL_MS = 15_000;

function normalizeLobby(lobbyId: string): string {
  const lobby = lobbyId.toUpperCase();
  if (!["A", "B", "C", "D"].includes(lobby)) {
    throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });
  }
  return lobby;
}

export async function touchLobbyPresence(userId: string, lobbyId: string): Promise<number> {
  const lobby = normalizeLobby(lobbyId);
  const now = new Date();
  const cutoff = new Date(now.getTime() - PRESENCE_TTL_MS);

  await db.$executeRaw`
    INSERT INTO color_lobby_presences (id, lobby_id, user_id, last_seen_at, created_at)
    VALUES (${randomUUID()}, ${lobby}, ${userId}, ${now}, ${now})
    ON CONFLICT (lobby_id, user_id)
    DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
  `;

  await db.$executeRaw`
    DELETE FROM color_lobby_presences
    WHERE lobby_id = ${lobby} AND last_seen_at < ${cutoff}
  `;

  return getLobbyPresenceCount(lobby);
}

export async function getLobbyPresenceCount(lobbyId: string): Promise<number> {
  const lobby = normalizeLobby(lobbyId);
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM color_lobby_presences
    WHERE lobby_id = ${lobby} AND last_seen_at >= ${cutoff}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function leaveLobbyPresence(userId: string, lobbyId: string): Promise<void> {
  const lobby = normalizeLobby(lobbyId);
  await db.$executeRaw`
    DELETE FROM color_lobby_presences
    WHERE lobby_id = ${lobby} AND user_id = ${userId}
  `;
}
