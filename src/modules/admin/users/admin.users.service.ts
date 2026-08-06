import { db } from "../../../db";
import { getTierLimits } from "../../withdrawals/limits";
import { config } from "../../../config";

function serializeAdminUser(u: any) {
  const kyc  = u.kyc;
  const sub  = u.subscription;
  const vip  = !!(sub?.isActive && sub.endsAt > new Date());
  const tier = vip ? "vip" : kyc?.status === "verified" ? "verified" : "free";
  const wl   = u.withdrawalLimit;
  const wallets = u.wallets ?? [];
  const walletBalances: Record<string, number> = {};
  for (const w of wallets) walletBalances[w.walletType] = typeof w.balance === "number" ? w.balance : parseFloat(String(w.balance));

  // Pre-compute totals — frontend must never calculate these.
  // Withdrawal-eligible wallets: game, task, referral, affiliate, ambassador (excludes main, task_vault).
  const WITHDRAWAL_WALLETS = ["game", "task", "referral", "affiliate", "ambassador"];
  const totalWithdrawableBalance = WITHDRAWAL_WALLETS.reduce((s, wt) => s + (walletBalances[wt] ?? 0), 0);
  const totalBalance = Object.values(walletBalances).reduce((s, v) => s + v, 0);

  return {
    userId:             u.id,
    email:              u.email,
    username:           u.profile?.username ?? "",
    fullName:           u.profile?.fullName ?? null,
    role:               u.role,
    referralCode:       u.referralCode,
    createdAt:          u.createdAt.toISOString(),
    suspendedAt:        u.suspendedAt?.toISOString() ?? null,
    verificationStatus: kyc?.status ?? "unverified",
    isVerified:         kyc?.status === "verified",
    vipStatus:          vip,
    phoneVerified:      u.profile?.phoneVerified ?? false,
    phoneNumber:        u.profile?.phoneNumber ?? null,
    tier,
    walletBalances,
    totalBalance:              parseFloat(totalBalance.toFixed(8)),
    totalWithdrawableBalance:  parseFloat(totalWithdrawableBalance.toFixed(8)),
    dailyWithdrawalUsed:   wl ? parseFloat(String(wl.dailyUsed)) : 0,
    monthlyWithdrawalUsed: wl ? parseFloat(String(wl.monthlyUsed)) : 0,
    // Use config.ts values for this display-only serializer (sync context).
    // The actual enforcement in withdrawals/limits.ts reads from SystemConfig.
    dailyLimit:    config.withdrawalLimits[tier as keyof typeof config.withdrawalLimits]?.daily   ?? 0,
    monthlyLimit:  config.withdrawalLimits[tier as keyof typeof config.withdrawalLimits]?.monthly ?? 0,
  };
}

const USER_INCLUDE = {
  profile:        true,
  kyc:            { select: { status: true } },
  subscription:   { select: { isActive: true, endsAt: true } },
  withdrawalLimit:{ select: { dailyUsed: true, monthlyUsed: true } },
  wallets:        { select: { walletType: true, balance: true } },
} as const;

export async function adminListUsers(opts: { cursor?: string; limit?: number; search?: string }) {
  const { cursor, limit = 50, search } = opts;
  const where: any = {};

  if (search) {
    where.OR = [
      { email:       { contains: search, mode: "insensitive" } },
      { referralCode:{ contains: search, mode: "insensitive" } },
      { profile: { username: { contains: search, mode: "insensitive" } } },
    ];
  }
  if (cursor) {
    const anchor = await db.user.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.user.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit + 1,
    include: USER_INCLUDE,
  });
  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;
  return { items: items.map(serializeAdminUser), nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
}

export async function adminGetUser(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, include: USER_INCLUDE });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  return serializeAdminUser(u);
}

export async function adminEditUser(userId: string, reviewerId: string, input: {
  role?: string;
  fullName?: string;
  username?: string;
}) {
  await db.user.findUnique({ where: { id: userId } }).then(u => {
    if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  });

  if (input.role) {
    await db.user.update({ where: { id: userId }, data: { role: input.role as any } });
  }
  if (input.username || input.fullName) {
    await db.userProfile.update({
      where: { userId },
      data: {
        ...(input.username && { username: input.username }),
        ...(input.fullName !== undefined && { fullName: input.fullName }),
      },
    });
  }
  return adminGetUser(userId);
}

export async function adminSuspendUser(userId: string, reviewerId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (u.suspendedAt) throw Object.assign(new Error("User already suspended"), { statusCode: 409, code: "ALREADY_SUSPENDED" });
  await db.user.update({ where: { id: userId }, data: { suspendedAt: new Date(), suspendedBy: reviewerId } });
  return adminGetUser(userId);
}

export async function adminUnsuspendUser(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  await db.user.update({ where: { id: userId }, data: { suspendedAt: null, suspendedBy: null } });
  return adminGetUser(userId);
}

export async function adminSetVerification(userId: string, status: string) {
  await db.kycSubmission.upsert({
    where:  { userId },
    create: { userId, status },
    update: { status },
  });
  return adminGetUser(userId);
}

export async function adminOverrideLimits(userId: string, dailyUsed: number, monthlyUsed: number) {
  await db.withdrawalLimit.upsert({
    where:  { userId },
    create: { userId, dailyUsed, monthlyUsed },
    update: { dailyUsed, monthlyUsed },
  });
  return adminGetUser(userId);
}

export async function adminForceVerifyEmail(userId: string, actorId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  const prev = u.emailVerified;
  await db.user.update({ where: { id: userId }, data: { emailVerified: true } });
  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId,
      action:        "POST /admin/users/:userId/force-verify-email",
      targetType:    "user",
      targetId:      userId,
      previousValue: prev ? "verified" : "unverified",
      newValue:      "verified",
      httpStatus:    200,
    }}).catch(() => {})
  );
  return adminGetUserDetail(userId);
}

export async function adminDisable2FA(userId: string, actorId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (!u.profile?.twoFactorEnabled) throw Object.assign(new Error("2FA is not enabled for this user"), { statusCode: 400, code: "2FA_NOT_ENABLED" });
  await db.userProfile.update({ where: { userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId,
      action:        "POST /admin/users/:userId/disable-2fa",
      targetType:    "user",
      targetId:      userId,
      previousValue: "enabled",
      newValue:      "disabled",
      httpStatus:    200,
    }}).catch(() => {})
  );
  return adminGetUserDetail(userId);
}

export async function adminClearPin(userId: string, actorId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  const existingPin = await db.securityPin.findUnique({ where: { userId } });
  if (!existingPin) throw Object.assign(new Error("User has no Security PIN set"), { statusCode: 400, code: "NO_PIN" });
  await db.securityPin.delete({ where: { userId } });
  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId,
      action:        "POST /admin/users/:userId/clear-pin",
      targetType:    "user",
      targetId:      userId,
      previousValue: "set",
      newValue:      "cleared",
      httpStatus:    200,
    }}).catch(() => {})
  );
  return adminGetUserDetail(userId);
}

export async function adminGetUserDetail(userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: {
      profile:        true,
      kyc:            true,
      subscription:   true,
      vipStreak:      true,
      withdrawalLimit:{ select: { dailyUsed: true, monthlyUsed: true } },
      wallets:        { select: { walletType: true, balance: true } },
      gameStats:      true,
      referralsSent:  { select: { isActive: true, referralRewarded: true, createdAt: true } },
      securityPin:    { select: { updatedAt: true } },
    },
  });
  if (!u) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });

  const [recentTransactions, taskCount, approvedCount, rewardsResult] = await Promise.all([
    db.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, type: true, amount: true, netAmount: true, status: true, description: true, createdAt: true },
    }),
    db.taskProof.count({ where: { userId } }),
    db.taskProof.count({ where: { userId, status: { in: ["approved", "admin_approved"] } } }),
    db.taskProof.aggregate({ where: { userId, rewardPaid: true }, _sum: { rewardAmount: true } }),
  ]);

  const kyc = u.kyc;
  const sub = u.subscription;
  const streak = u.vipStreak;
  const vip = !!(sub?.isActive && sub.endsAt > new Date());
  const tier = vip ? "vip" : kyc?.status === "verified" ? "verified" : "free";
  const wl = u.withdrawalLimit;
  const wallets = u.wallets ?? [];
  const walletBalances: Record<string, number> = {};
  for (const w of wallets) walletBalances[w.walletType] = typeof w.balance === "number" ? w.balance : parseFloat(String(w.balance));

  const WITHDRAWAL_WALLETS = ["game", "task", "referral", "affiliate", "ambassador"];
  const totalWithdrawableBalance = WITHDRAWAL_WALLETS.reduce((s, wt) => s + (walletBalances[wt] ?? 0), 0);
  const totalBalance = Object.values(walletBalances).reduce((s, v) => s + v, 0);

  return {
    userId:             u.id,
    email:              u.email,
    username:           u.profile?.username ?? "",
    fullName:           u.profile?.fullName ?? null,
    role:               u.role,
    referralCode:       u.referralCode,
    affiliateCode:      u.affiliateCode,
    createdAt:          u.createdAt.toISOString(),
    suspendedAt:        u.suspendedAt?.toISOString() ?? null,
    suspendedBy:        u.suspendedBy ?? null,
    verificationStatus: kyc?.status ?? "unverified",
    isVerified:         kyc?.status === "verified",
    vipStatus:          vip,
    phoneVerified:      u.profile?.phoneVerified ?? false,
    phoneNumber:        u.profile?.phoneNumber ?? null,
    tier,
    walletBalances,
    totalBalance:             parseFloat(totalBalance.toFixed(8)),
    totalWithdrawableBalance: parseFloat(totalWithdrawableBalance.toFixed(8)),
    dailyWithdrawalUsed:   wl ? parseFloat(String(wl.dailyUsed)) : 0,
    monthlyWithdrawalUsed: wl ? parseFloat(String(wl.monthlyUsed)) : 0,
    ...(await getTierLimits(tier as any).then(l => ({ dailyLimit: l.daily, monthlyLimit: l.monthly }))),
    kycDetail: kyc ? {
      status:          kyc.status,
      submittedAt:     kyc.submittedAt?.toISOString() ?? null,
      reviewedAt:      kyc.reviewedAt?.toISOString() ?? null,
      reviewedBy:      kyc.reviewedBy ?? null,
      rejectionReason: kyc.rejectionReason ?? null,
      countryCode:     kyc.countryCode ?? null,
      idType:          kyc.idType ?? null,
      fullName:        kyc.fullName ?? null,
      dateOfBirth:     kyc.dateOfBirth ?? null,
      address:         kyc.address ?? null,
    } : null,
    vipDetail: sub ? {
      plan:      sub.plan,
      startedAt: sub.startedAt.toISOString(),
      endsAt:    sub.endsAt.toISOString(),
      isActive:  vip,
      streak: streak ? { currentStreak: streak.currentStreak, totalEarned: parseFloat(String(streak.totalEarned)) } : null,
    } : null,
    gameStats: u.gameStats.map(s => ({
      gameType:     s.gameType,
      totalGames:   s.totalGames,
      wins:         s.wins,
      losses:       s.losses,
      totalWagered: parseFloat(String(s.totalWagered)),
      totalWon:     parseFloat(String(s.totalWon)),
    })),
    recentTransactions: recentTransactions.map(t => ({
      id:          t.id,
      type:        t.type,
      amount:      parseFloat(String(t.amount)),
      netAmount:   parseFloat(String(t.netAmount)),
      status:      t.status,
      description: t.description ?? null,
      createdAt:   t.createdAt.toISOString(),
    })),
    taskSummary: {
      totalProofs:        taskCount,
      approvedProofs:     approvedCount,
      totalRewardsEarned: parseFloat(String(rewardsResult._sum.rewardAmount ?? 0)),
    },
    // Security & payment details
    emailVerified:      u.emailVerified ?? false,
    twoFactorEnabled:   u.profile?.twoFactorEnabled ?? false,
    pinStatus:          u.securityPin ? "set" : "not_set",
    bankName:           u.profile?.bankName ?? null,
    bankAccountName:    u.profile?.bankAccountName ?? null,
    bankAccountNumber:  u.profile?.bankAccountNumber ?? null,
    usdtAddress:        u.profile?.usdtAddress ?? null,
    referralSummary: {
      totalReferrals:    u.referralsSent.length,
      activeReferrals:   u.referralsSent.filter(r => r.isActive).length,
      rewardedReferrals: u.referralsSent.filter(r => r.referralRewarded).length,
    },
  };
}
