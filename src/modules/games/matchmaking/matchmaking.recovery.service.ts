import { db } from "../../../db";
import type { MatchGameType } from "./matchmaking.service";

const QUEUE_LEASE_MS = 20 * 1000;

export async function getActiveMatchmaking(userId: string, gameType: MatchGameType, stake: number) {
  const activeMatch = await db.pvpMatch.findFirst({
    where: {
      gameType,
      status: { in: ["active", "settling"] },
      stake,
      OR: [{ player1Id: userId }, { player2Id: userId }],
    },
    orderBy: { createdAt: "desc" },
  });

  if (activeMatch) {
    return { status: "matched" as const, matchId: activeMatch.id, queueId: null };
  }

  const queue = await db.matchmakingQueue.findFirst({
    where: {
      userId,
      gameType,
      stake,
      status: "waiting",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (queue) {
    return { status: "waiting" as const, queueId: queue.id, matchId: null };
  }

  return { status: "none" as const, queueId: null, matchId: null };
}

export async function heartbeatMatchmakingQueue(userId: string, queueId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUEUE_LEASE_MS);

  const claimed = await db.matchmakingQueue.updateMany({
    where: {
      id: queueId,
      userId,
      status: "waiting",
      expiresAt: { gt: now },
    },
    data: { expiresAt },
  });

  if (!claimed.count) {
    const current = await db.matchmakingQueue.findFirst({
      where: { id: queueId, userId },
      select: { status: true, matchId: true, expiresAt: true },
    });

    if (current?.status === "matched" && current.matchId) {
      return { status: "matched" as const, matchId: current.matchId };
    }

    return { status: "cancelled" as const, matchId: null };
  }

  return { status: "waiting" as const, matchId: null, expiresAt: expiresAt.toISOString() };
}
