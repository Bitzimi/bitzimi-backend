/**
 * Public platform routes — no authentication required.
 * Used by landing page and other public-facing features.
 */
import { FastifyInstance } from "fastify";
import { db } from "../../db";
import { dec } from "../../utils/dec";

const GAME_LABEL: Record<string, string> = {
  color_game:   "Color Prediction",
  spin_battle:  "Spin Battle",
  dice_duel:    "Dice Duel",
  coin_flip:    "Coin Flip",
  reaction_tap: "Reaction Tap",
  dice_royale:  "Dice Royale",
  dice_arena:   "Dice Arena",
};

const ACTIVITY_LABEL: Record<string, string> = {
  deposit:              "deposited to wallet",
  withdrawal:           "completed withdrawal",
  transfer:             "transferred funds",
  game_win:             "won a game",
  game_bet:             "joined a game",
  task_reward:          "earned task reward",
  referral_bonus:       "earned referral bonus",
  vip_purchase:         "upgraded to VIP",
  affiliate_commission: "earned affiliate commission",
  commission:           "earned affiliate commission",
  streak_reward:        "claimed daily streak",
};

const ACTIVITY_TYPE_ICON: Record<string, string> = {
  deposit: "💰", withdrawal: "📤", transfer: "↔️", game_win: "🏆",
  game_bet: "🎮", task_reward: "✅", referral_bonus: "👥",
  vip_purchase: "👑", affiliate_commission: "💎", commission: "💎",
  streak_reward: "🔥",
};

export async function publicRoutes(app: FastifyInstance) {

  // GET /api/v1/public/stats — landing page hero stats (no auth)
  app.get("/stats", async (_req, reply) => {
    const [totalUsers, activeBattles, recentWins] = await Promise.all([
      db.user.count({ where: { suspendedAt: null } }),
      db.gameRound.count({
        where: { status: { in: ["waiting", "countdown", "spinning", "result"] } },
      }),
      db.gameBet.findMany({
        where: { outcome: "win", settledAt: { not: null } },
        orderBy: { settledAt: "desc" },
        take: 5,
        select: {
          amount: true, payout: true, settledAt: true,
          user:  { select: { profile: { select: { username: true } } } },
          round: { select: { gameType: true } },
        },
      }),
    ]);

    return reply.send({
      data: {
        totalUsers,
        activeBattles,
        recentWins: recentWins.map(b => ({
          username:  b.user?.profile?.username ?? "Player",
          amount:    dec(b.payout),
          gameType:  b.round?.gameType ?? "game",
          gameLabel: GAME_LABEL[b.round?.gameType ?? ""] ?? "Game",
          timestamp: b.settledAt?.toISOString() ?? new Date().toISOString(),
        })),
      },
    });
  });

  // GET /api/v1/public/activity — live ticker activities (no auth, latest 8)
  app.get("/activity", async (_req, reply) => {
    // Pull the most recent transactions across all users as "platform activity"
    const txns = await db.transaction.findMany({
      where: { status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        type: true, amount: true, createdAt: true,
        user: { select: { profile: { select: { username: true } } } },
      },
    });

    const activities = txns.map(t => ({
      type:        t.type,
      icon:        ACTIVITY_TYPE_ICON[t.type] ?? "📊",
      label:       ACTIVITY_LABEL[t.type] ?? "performed an action",
      username:    t.user?.profile?.username ?? "Player",
      amount:      dec(t.amount),
      timestamp:   t.createdAt.toISOString(),
    }));

    return reply.send({ data: { activities } });
  });

  // GET /api/v1/public/marketplace — task marketplace live stats (no auth)
  app.get("/marketplace", async (_req, reply) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      activeCampaigns,
      tasksAvailable,
      completedToday,
      rewardsPaidResult,
    ] = await Promise.all([
      db.task.count({ where: { status: "active" } }),
      db.task.aggregate({
        where: { status: "active" },
        _sum: { totalSlots: true, completedSlots: true },
      }),
      db.taskProof.count({
        where: { status: { in: ["approved", "admin_approved"] }, processedAt: { gte: today } },
      }),
      db.taskProof.aggregate({
        where: { status: { in: ["approved", "admin_approved"] }, rewardPaid: true },
        _sum: { rewardAmount: true },
      }),
    ]);

    const totalSlots     = tasksAvailable._sum.totalSlots ?? 0;
    const completedSlots = tasksAvailable._sum.completedSlots ?? 0;
    const slotsAvailable = Math.max(0, totalSlots - completedSlots);
    const rewardsPaid    = dec(rewardsPaidResult._sum.rewardAmount);

    return reply.send({
      data: {
        activeCampaigns,
        tasksAvailable: slotsAvailable,
        completedToday,
        rewardsPaidUSD: rewardsPaid,
      },
    });
  });
}
