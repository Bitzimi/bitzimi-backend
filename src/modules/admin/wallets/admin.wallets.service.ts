import { db } from "../../../db";
import { dec } from "../../../utils/dec";
import { writeLedgerEntry, creditWallet, debitWallet, type WalletType } from "../../wallets/wallets.service";

const ALL_WALLET_TYPES: WalletType[] = [
  "main", "game", "task", "referral", "affiliate", "task_vault", "ambassador",
];

// ── Dashboard Stats ────────────────────────────────────────────────────────────

export async function adminGetWalletStats() {
  const [wallets, frozenCount, totalUsers] = await Promise.all([
    db.wallet.findMany({ select: { walletType: true, balance: true, isFrozen: true } }),
    db.wallet.count({ where: { isFrozen: true } }),
    db.user.count({ where: { deletedAt: null } }),
  ]);

  const byType: Record<string, { totalBalance: number; walletCount: number; frozenCount: number }> = {};
  for (const t of ALL_WALLET_TYPES) {
    byType[t] = { totalBalance: 0, walletCount: 0, frozenCount: 0 };
  }

  let grandTotal = 0;
  let activeWallets = 0;
  for (const w of wallets) {
    const b = dec(w.balance);
    if (!byType[w.walletType]) byType[w.walletType] = { totalBalance: 0, walletCount: 0, frozenCount: 0 };
    byType[w.walletType].totalBalance += b;
    byType[w.walletType].walletCount += 1;
    if (w.isFrozen) byType[w.walletType].frozenCount += 1;
    grandTotal += b;
    if (b > 0) activeWallets += 1;
  }

  // Round totals
  for (const t of Object.keys(byType)) {
    byType[t].totalBalance = parseFloat(byType[t].totalBalance.toFixed(8));
  }

  return {
    grandTotalBalance: parseFloat(grandTotal.toFixed(8)),
    totalFrozenWallets: frozenCount,
    totalActiveWallets: activeWallets,
    totalUsers,
    byType,
  };
}

// ── User Wallet Explorer ───────────────────────────────────────────────────────

export async function adminSearchWalletUsers(opts: {
  search?: string;
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 20, 100);

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      ...(opts.search ? {
        OR: [
          { email: { contains: opts.search } },
          { profile: { username: { contains: opts.search } } },
        ],
      } : {}),
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      profile: { select: { username: true, fullName: true } },
      wallets: {
        select: {
          walletType: true,
          balance: true,
          isFrozen: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = users.length > limit;
  const page = users.slice(0, limit);

  return {
    users: page.map((u) => {
      const balances: Record<string, number> = {};
      let totalBalance = 0;
      let hasFrozenWallet = false;
      let lastActivity: string | null = null;

      for (const w of u.wallets) {
        balances[w.walletType] = dec(w.balance);
        totalBalance += dec(w.balance);
        if (w.isFrozen) hasFrozenWallet = true;
        const t = w.updatedAt.toISOString();
        if (!lastActivity || t > lastActivity) lastActivity = t;
      }

      return {
        userId: u.id,
        email: u.email,
        username: u.profile?.username ?? null,
        fullName: u.profile?.fullName ?? null,
        createdAt: u.createdAt.toISOString(),
        totalBalance: parseFloat(totalBalance.toFixed(8)),
        balances,
        hasFrozenWallet,
        lastActivity,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// ── User Wallet Detail ────────────────────────────────────────────────────────

export async function adminGetUserWallets(userId: string) {
  const [user, wallets] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        profile: { select: { username: true, fullName: true } },
      },
    }),
    db.wallet.findMany({
      where: { userId },
      select: {
        walletType: true,
        balance: true,
        lockedAmount: true,
        isFrozen: true,
        frozenAt: true,
        frozenBy: true,
        frozenReason: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });

  const walletMap: Record<string, any> = {};
  for (const t of ALL_WALLET_TYPES) {
    walletMap[t] = { walletType: t, balance: 0, lockedAmount: 0, isFrozen: false, frozenAt: null, frozenBy: null, frozenReason: null, updatedAt: null };
  }
  for (const w of wallets) {
    walletMap[w.walletType] = {
      walletType: w.walletType,
      balance: dec(w.balance),
      lockedAmount: dec(w.lockedAmount),
      isFrozen: w.isFrozen,
      frozenAt: w.frozenAt?.toISOString() ?? null,
      frozenBy: w.frozenBy ?? null,
      frozenReason: w.frozenReason ?? null,
      updatedAt: w.updatedAt?.toISOString() ?? null,
    };
  }

  return {
    userId: user.id,
    email: user.email,
    username: user.profile?.username ?? null,
    fullName: user.profile?.fullName ?? null,
    wallets: Object.values(walletMap),
  };
}

// ── Wallet Ledger ─────────────────────────────────────────────────────────────

export async function adminGetWalletLedger(opts: {
  userId?: string;
  walletType?: string;
  type?: string;
  cursor?: string;
  limit?: number;
  from?: string;
  to?: string;
}) {
  const limit = Math.min(opts.limit ?? 30, 200);

  const where: any = {};
  if (opts.userId) where.userId = opts.userId;
  if (opts.walletType) {
    where.OR = [
      { fromWallet: opts.walletType },
      { toWallet: opts.walletType },
    ];
  }
  if (opts.type) where.type = opts.type;
  if (opts.from || opts.to) {
    where.createdAt = {};
    if (opts.from) where.createdAt.gte = new Date(opts.from);
    if (opts.to)   where.createdAt.lte = new Date(opts.to);
  }

  const rows = await db.transaction.findMany({
    where,
    select: {
      id: true,
      userId: true,
      type: true,
      fromWallet: true,
      toWallet: true,
      amount: true,
      fee: true,
      netAmount: true,
      status: true,
      description: true,
      referenceId: true,
      referenceType: true,
      createdAt: true,
      user: { select: { email: true, profile: { select: { username: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    entries: page.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.user.email,
      username: r.user.profile?.username ?? null,
      type: r.type,
      fromWallet: r.fromWallet,
      toWallet: r.toWallet,
      amount: dec(r.amount),
      fee: dec(r.fee),
      netAmount: dec(r.netAmount),
      status: r.status,
      description: r.description,
      referenceId: r.referenceId,
      referenceType: r.referenceType,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// ── Manual Credit ─────────────────────────────────────────────────────────────

export async function adminCreditUserWallet(opts: {
  userId: string;
  walletType: WalletType;
  amount: number;
  reason: string;
  adminId: string;
}) {
  const { userId, walletType, amount, reason, adminId } = opts;
  if (amount <= 0) throw Object.assign(new Error("Amount must be positive"), { statusCode: 400, code: "INVALID_AMOUNT" });

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });

  // Ensure wallet row exists
  await db.wallet.upsert({
    where: { userId_walletType: { userId, walletType } },
    create: { userId, walletType, balance: 0 },
    update: {},
  });

  const balanceBefore = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
    select: { balance: true },
  });
  const before = dec(balanceBefore?.balance);

  await db.$transaction(async (tx) => {
    await creditWallet(tx, userId, walletType, amount);
    await writeLedgerEntry(tx, {
      userId,
      type: "admin_credit",
      toWallet: walletType,
      amount,
      description: `Admin credit: ${reason}`,
      referenceType: "admin_action",
      referenceId: adminId,
      metadata: { adminId, reason, balanceBefore: before },
    });
  });

  const balanceAfter = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
    select: { balance: true },
  });

  return {
    userId,
    walletType,
    amount,
    balanceBefore: before,
    balanceAfter: dec(balanceAfter?.balance),
    reason,
    adminId,
  };
}

// ── Manual Debit ──────────────────────────────────────────────────────────────

export async function adminDebitUserWallet(opts: {
  userId: string;
  walletType: WalletType;
  amount: number;
  reason: string;
  adminId: string;
}) {
  const { userId, walletType, amount, reason, adminId } = opts;
  if (amount <= 0) throw Object.assign(new Error("Amount must be positive"), { statusCode: 400, code: "INVALID_AMOUNT" });

  const wallet = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
    select: { balance: true, isFrozen: true },
  });
  if (!wallet) throw Object.assign(new Error("Wallet not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (wallet.isFrozen) throw Object.assign(new Error("Wallet is frozen — unfreeze before debiting"), { statusCode: 400, code: "WALLET_FROZEN" });

  const before = dec(wallet.balance);
  if (before < amount) throw Object.assign(new Error("Insufficient balance"), { statusCode: 400, code: "INSUFFICIENT_BALANCE" });

  await db.$transaction(async (tx) => {
    await debitWallet(tx, userId, walletType, amount);
    await writeLedgerEntry(tx, {
      userId,
      type: "admin_debit",
      fromWallet: walletType,
      amount,
      description: `Admin debit: ${reason}`,
      referenceType: "admin_action",
      referenceId: adminId,
      metadata: { adminId, reason, balanceBefore: before },
    });
  });

  const balanceAfter = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
    select: { balance: true },
  });

  return {
    userId,
    walletType,
    amount,
    balanceBefore: before,
    balanceAfter: dec(balanceAfter?.balance),
    reason,
    adminId,
  };
}

// ── Freeze Wallet ─────────────────────────────────────────────────────────────

export async function adminFreezeWallet(opts: {
  userId: string;
  walletType: WalletType;
  reason: string;
  adminId: string;
}) {
  const { userId, walletType, reason, adminId } = opts;

  const wallet = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
    select: { isFrozen: true, balance: true },
  });

  if (!wallet) {
    await db.wallet.upsert({
      where: { userId_walletType: { userId, walletType } },
      create: { userId, walletType, balance: 0 },
      update: {},
    });
  }

  if (wallet?.isFrozen) throw Object.assign(new Error("Wallet is already frozen"), { statusCode: 400, code: "ALREADY_FROZEN" });

  const before = dec(wallet?.balance);

  await db.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId_walletType: { userId, walletType } },
      data: {
        isFrozen: true,
        frozenAt: new Date(),
        frozenBy: adminId,
        frozenReason: reason,
      },
    });
    await writeLedgerEntry(tx, {
      userId,
      type: "wallet_freeze",
      fromWallet: walletType,
      amount: 0,
      description: `Wallet frozen by admin: ${reason}`,
      referenceType: "admin_action",
      referenceId: adminId,
      metadata: { adminId, reason, balanceBefore: before },
    });
  });

  return { userId, walletType, frozen: true, reason, adminId };
}

// ── Unfreeze Wallet ───────────────────────────────────────────────────────────

export async function adminUnfreezeWallet(opts: {
  userId: string;
  walletType: WalletType;
  adminId: string;
}) {
  const { userId, walletType, adminId } = opts;

  const wallet = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
    select: { isFrozen: true, balance: true },
  });
  if (!wallet) throw Object.assign(new Error("Wallet not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (!wallet.isFrozen) throw Object.assign(new Error("Wallet is not frozen"), { statusCode: 400, code: "NOT_FROZEN" });

  const before = dec(wallet.balance);

  await db.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId_walletType: { userId, walletType } },
      data: { isFrozen: false, frozenAt: null, frozenBy: null, frozenReason: null },
    });
    await writeLedgerEntry(tx, {
      userId,
      type: "wallet_unfreeze",
      toWallet: walletType,
      amount: 0,
      description: `Wallet unfrozen by admin`,
      referenceType: "admin_action",
      referenceId: adminId,
      metadata: { adminId, balanceBefore: before },
    });
  });

  return { userId, walletType, frozen: false, adminId };
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export async function adminRunWalletDiagnostics() {
  const issues: Array<{
    severity: "critical" | "warning";
    type: string;
    userId: string;
    walletType: string;
    balance: number;
    detail: string;
  }> = [];

  // 1. Negative balances
  const negativeWallets = await db.wallet.findMany({
    where: { balance: { lt: 0 } },
    select: { userId: true, walletType: true, balance: true },
  });
  for (const w of negativeWallets) {
    issues.push({
      severity: "critical",
      type: "negative_balance",
      userId: w.userId,
      walletType: w.walletType,
      balance: dec(w.balance),
      detail: `Balance is ${dec(w.balance).toFixed(8)} — should never be negative`,
    });
  }

  // 2. Wallets with lockedAmount > balance
  const overlocked = await db.$queryRaw<Array<{ userId: string; walletType: string; balance: number; lockedAmount: number }>>`
    SELECT user_id AS userId, wallet_type AS walletType, balance, locked_amount AS lockedAmount
    FROM wallets
    WHERE locked_amount > balance AND balance >= 0
  `;
  for (const w of overlocked) {
    issues.push({
      severity: "warning",
      type: "locked_exceeds_balance",
      userId: w.userId,
      walletType: w.walletType,
      balance: dec(w.balance),
      detail: `lockedAmount (${dec(w.lockedAmount).toFixed(8)}) exceeds balance (${dec(w.balance).toFixed(8)})`,
    });
  }

  // 3. Users with no wallets at all
  const usersWithoutWallets = await db.$queryRaw<Array<{ userId: string; email: string }>>`
    SELECT u.id AS userId, u.email
    FROM users u
    WHERE u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id)
    LIMIT 50
  `;
  for (const u of usersWithoutWallets) {
    issues.push({
      severity: "warning",
      type: "no_wallets",
      userId: u.userId,
      walletType: "all",
      balance: 0,
      detail: `User ${u.email} has no wallet rows — wallets are lazily created on first use`,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    totalIssues: issues.length,
    criticalCount: issues.filter(i => i.severity === "critical").length,
    warningCount: issues.filter(i => i.severity === "warning").length,
    issues,
  };
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export async function adminGetWalletAuditLog(opts: {
  cursor?: string;
  limit?: number;
  adminId?: string;
}) {
  const limit = Math.min(opts.limit ?? 30, 200);

  const rows = await db.transaction.findMany({
    where: {
      type: { in: ["admin_credit", "admin_debit", "wallet_freeze", "wallet_unfreeze"] },
      ...(opts.adminId ? { referenceId: opts.adminId } : {}),
    },
    select: {
      id: true,
      userId: true,
      type: true,
      fromWallet: true,
      toWallet: true,
      amount: true,
      description: true,
      referenceId: true,
      metadata: true,
      createdAt: true,
      user: { select: { email: true, profile: { select: { username: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    entries: page.map((r) => {
      let meta: any = {};
      try { meta = r.metadata ? JSON.parse(r.metadata as string) : {}; } catch {}
      const walletType = r.fromWallet ?? r.toWallet ?? "unknown";
      return {
        id: r.id,
        userId: r.userId,
        userEmail: r.user.email,
        username: r.user.profile?.username ?? null,
        type: r.type,
        walletType,
        amount: dec(r.amount),
        description: r.description,
        adminId: r.referenceId,
        reason: meta.reason ?? null,
        balanceBefore: meta.balanceBefore ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    }),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}
