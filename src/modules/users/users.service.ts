import { db } from "../../db";
import { dec } from "../../utils/dec";
import { UserRole } from "../../utils/jwt";
import { ROLE_PERMISSIONS } from "../../utils/rolePermissions";

export async function getMe(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true, kyc: { select: { status: true } }, subscription: { select: { isActive: true, endsAt: true, plan: true } }, vipStreak: { select: { currentStreak: true, lastClaimDate: true, totalEarned: true } } },
  });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });

  const role = user.role as UserRole;
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  const isVIP = !!(user.subscription?.isActive && user.subscription?.endsAt && new Date(user.subscription.endsAt) > new Date());

  return {
    id: user.id, email: user.email, role, permissions, referralCode: user.referralCode, affiliateCode: user.affiliateCode, createdAt: user.createdAt.toISOString(),
    profile: { username: user.profile?.username ?? "", fullName: user.profile?.fullName ?? null, avatarUrl: user.profile?.avatarUrl ?? null, phoneNumber: user.profile?.phoneNumber ?? null, phoneVerified: user.profile?.phoneVerified ?? false, languagePref: user.profile?.languagePref ?? "en", currencyPref: user.profile?.currencyPref ?? "USD" },
    verification: { status: user.kyc?.status ?? "unverified" },
    vip: { isActive: isVIP, endsAt: user.subscription?.endsAt?.toISOString() ?? null, plan: user.subscription?.plan ?? null, streak: { current: user.vipStreak?.currentStreak ?? 0, lastClaim: user.vipStreak?.lastClaimDate?.toISOString() ?? null, totalEarned: dec(user.vipStreak?.totalEarned) } },
  };
}

export async function updateMe(userId: string, input: { username?: string; fullName?: string; languagePref?: string; currencyPref?: string }) {
  if (input.username) {
    const taken = await db.userProfile.findFirst({ where: { username: input.username, userId: { not: userId } } });
    if (taken) throw Object.assign(new Error("Username already taken"), { statusCode: 409, code: "USERNAME_TAKEN" });
  }
  await db.userProfile.update({ where: { userId }, data: { ...(input.username && { username: input.username }), ...(input.fullName !== undefined && { fullName: input.fullName }), ...(input.languagePref && { languagePref: input.languagePref }), ...(input.currencyPref && { currencyPref: input.currencyPref }) } });
  return getMe(userId);
}
