import { z } from "zod";

export const TASK_CATEGORIES = [
  "social_media_follow","social_media_like","social_media_share","social_media_comment",
  "youtube_watch","youtube_subscribe","youtube_like","youtube_comment",
  "website_visit","app_download_registration","survey_completion","review_writing",
  "content_creation","email_signup","forum_participation","discord_join",
  "telegram_join","play_game","referral_task","custom_task",
] as const;

export const CreateTaskSchema = z.object({
  title:             z.string().min(3).max(120),
  description:       z.string().max(2000).optional(),
  type:              z.enum(TASK_CATEGORIES),
  totalBudget:       z.number().positive(),
  rewardPerSlot:     z.number().positive(),
  totalSlots:        z.number().int().min(1).max(10000),
  link:              z.string().url("Must be a valid URL").optional(),
  campaignImageUrl:  z.string().url().optional(),
  requirements:      z.array(z.string()).max(10).default([]),
  proofType:         z.string().optional(),
  proofInstructions: z.string().max(1000).optional(),
  expiresAt:         z.string().datetime().optional(),
  // Reference screenshots: up to 3 base64 data URLs uploaded at task creation
  referenceScreenshots: z.array(
    z.string().refine(v => v.startsWith("data:") || v.startsWith("/uploads/"), "Must be a data URL or storage path")
  ).max(3).default([]),
}).refine(d => Math.abs(d.totalBudget - d.rewardPerSlot * d.totalSlots) < 0.01, {
  message: "totalBudget must equal rewardPerSlot × totalSlots",
  path: ["totalBudget"],
});

export const UpdateTaskSchema = z.object({
  title:             z.string().min(3).max(120).optional(),
  description:       z.string().max(2000).optional(),
  link:              z.string().url().optional(),
  proofInstructions: z.string().max(1000).optional(),
  status:            z.enum(["active", "paused"]).optional(), // advertiser can only pause/resume
});

export const ListTasksQuery = z.object({
  cursor:  z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(50).default(20),
  type:    z.string().optional(),
  status:  z.string().default("active"),
});
