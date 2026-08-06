/**
 * Ambassador Program Service — Phase 20 Foundation
 *
 * Handles application submission, status queries, and admin review.
 * The ambassador wallet and commission logic are already wired in the
 * commission engine (commissions.ts) via programLevel checks.
 */
import { db } from "../../db";
import { getConfigValue } from "../admin/config/admin.config.service";

export async function applyForAmbassador(userId: string, input: {
  username:    string;
  bio?:        string;
  socialLinks?: string[];
}): Promise<{ id: string; status: string }> {
  // Feature gate — disabled by default until Phase 20.3 launch
  const enabled = await getConfigValue<boolean>("feature.ambassador_program", false);
  if (!enabled) {
    throw Object.assign(new Error("Ambassador program is not yet open"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }

  // One application per user
  const existing = await db.ambassadorApplication.findUnique({ where: { userId } });
  if (existing) {
    throw Object.assign(new Error("Ambassador application already submitted"), {
      statusCode: 409, code: "ALREADY_APPLIED",
    });
  }

  // Username must be unique across existing ambassador codes
  if (input.username) {
    const taken = await db.user.findUnique({ where: { ambassadorCode: input.username } });
    if (taken) {
      throw Object.assign(new Error("Ambassador username is already taken"), {
        statusCode: 409, code: "USERNAME_TAKEN",
      });
    }
    const takenApp = await db.ambassadorApplication.findFirst({
      where: { username: input.username, status: { not: "rejected" } },
    });
    if (takenApp) {
      throw Object.assign(new Error("Ambassador username is already taken"), {
        statusCode: 409, code: "USERNAME_TAKEN",
      });
    }
  }

  const app = await db.ambassadorApplication.create({
    data: {
      userId,
      username:   input.username,
      bio:        input.bio ?? null,
      socialLinks: JSON.stringify(input.socialLinks ?? []),
    },
  });

  return { id: app.id, status: app.status };
}

export async function getMyAmbassadorStatus(userId: string) {
  const user = await db.user.findUnique({
    where:  { id: userId },
    select: { programLevel: true, ambassadorCode: true },
  });

  const app = await db.ambassadorApplication.findUnique({ where: { userId } });

  return {
    programLevel:    user?.programLevel ?? "referral",
    ambassadorCode:  user?.ambassadorCode ?? null,
    application:     app ? {
      id:             app.id,
      status:         app.status,
      username:       app.username,
      rejectionReason: app.rejectionReason ?? null,
      createdAt:      app.createdAt.toISOString(),
    } : null,
  };
}

export async function getAmbassadorActivityScore(userId: string) {
  const score = await db.ambassadorActivityScore.findUnique({ where: { userId } });
  if (!score) return {
    gameScore: 0, depositScore: 0, vipScore: 0, taskScore: 0,
    footballScore: 0, otherScore: 0, compositeScore: 0,
  };
  return {
    gameScore:     score.gameScore,
    depositScore:  score.depositScore,
    vipScore:      score.vipScore,
    taskScore:     score.taskScore,
    footballScore: score.footballScore,
    otherScore:    score.otherScore,
    compositeScore:score.compositeScore,
    updatedAt:     score.updatedAt.toISOString(),
  };
}

// ── Admin operations ──────────────────────────────────────────────────────────

export async function adminReviewAmbassadorApp(appId: string, reviewerId: string, decision: {
  action:          "approve" | "reject";
  rejectionReason?: string;
}): Promise<void> {
  const app = await db.ambassadorApplication.findUnique({ where: { id: appId } });
  if (!app) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
  if (app.status !== "pending") {
    throw Object.assign(new Error("Application already reviewed"), { statusCode: 409 });
  }

  await db.$transaction(async (tx) => {
    await tx.ambassadorApplication.update({
      where: { id: appId },
      data: {
        status:          decision.action === "approve" ? "approved" : "rejected",
        rejectionReason: decision.rejectionReason ?? null,
        reviewedBy:      reviewerId,
        reviewedAt:      new Date(),
      },
    });

    if (decision.action === "approve") {
      await tx.user.update({
        where: { id: app.userId },
        data: {
          programLevel:  "ambassador",
          ambassadorCode: app.username,
        },
      });
    }
  });
}

export async function adminListAmbassadorApps(status?: string) {
  const apps = await db.ambassadorApplication.findMany({
    where:   status ? { status } : undefined,
    include: { user: { select: { id: true, email: true, profile: { select: { username: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return apps.map(a => ({
    id:              a.id,
    status:          a.status,
    username:        a.username,
    bio:             a.bio,
    rejectionReason: a.rejectionReason,
    reviewedAt:      a.reviewedAt?.toISOString() ?? null,
    createdAt:       a.createdAt.toISOString(),
    user: {
      id:       a.user.id,
      email:    a.user.email,
      username: a.user.profile?.username ?? null,
    },
  }));
}
