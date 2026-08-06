/**
 * Admin Content Service — FAQs, Help articles, Blog posts, Announcements.
 *
 * Content is stored in ContentPost. Body is Markdown.
 * Admins publish/unpublish; the public-facing API returns only published entries.
 */
import { db } from "../../../db";
import { v4 as uuid } from "uuid";

export type ContentCategory = "faq" | "help" | "blog" | "announcement";
export type ContentStatus = "draft" | "published";

export interface ContentPostItem {
  id:          string;
  slug:        string;
  category:    ContentCategory;
  title:       string;
  excerpt:     string | null;
  status:      ContentStatus;
  publishedAt: string | null;
  createdBy:   string;
  updatedBy:   string | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface ContentPostDetail extends ContentPostItem {
  body: string;
}

// ── List ───────────────────────────────────────────────────────────────────────

export async function adminListContent(opts: {
  category?: ContentCategory;
  status?:   ContentStatus;
  search?:   string;
  cursor?:   string;
  limit?:    number;
}) {
  const { category, status, search, cursor, limit = 50 } = opts;
  const take = Math.min(limit, 100);

  const where: any = {};
  if (category) where.category = category;
  if (status)   where.status   = status;
  if (search?.trim()) {
    where.OR = [
      { title:   { contains: search.trim() } },
      { excerpt: { contains: search.trim() } },
    ];
  }

  if (cursor) {
    const anchor = await db.contentPost.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.contentPost.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    select: {
      id: true, slug: true, category: true, title: true, excerpt: true,
      status: true, publishedAt: true, createdBy: true, updatedBy: true,
      createdAt: true, updatedAt: true,
    },
  });

  const hasMore    = rows.length > take;
  const items      = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    items: items.map(r => ({
      ...r,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt:   r.createdAt.toISOString(),
      updatedAt:   r.updatedAt.toISOString(),
    })) as ContentPostItem[],
    nextCursor,
    hasMore,
  };
}

// ── Get one ────────────────────────────────────────────────────────────────────

export async function adminGetContent(id: string): Promise<ContentPostDetail> {
  const row = await db.contentPost.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("Content post not found"), { statusCode: 404 });
  return {
    id:          row.id,
    slug:        row.slug,
    category:    row.category as ContentCategory,
    title:       row.title,
    body:        row.body,
    excerpt:     row.excerpt ?? null,
    status:      row.status as ContentStatus,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy:   row.createdBy,
    updatedBy:   row.updatedBy ?? null,
    createdAt:   row.createdAt.toISOString(),
    updatedAt:   row.updatedAt.toISOString(),
  };
}

// ── Create ─────────────────────────────────────────────────────────────────────

export async function adminCreateContent(data: {
  category:  ContentCategory;
  title:     string;
  body:      string;
  excerpt?:  string;
  slug?:     string;
}, adminId: string): Promise<ContentPostDetail> {
  const slug = data.slug?.trim() || slugify(data.title);
  const existing = await db.contentPost.findUnique({ where: { slug } });
  if (existing) throw Object.assign(new Error("A post with this slug already exists"), { statusCode: 409 });

  const row = await db.contentPost.create({
    data: {
      id:        uuid(),
      slug,
      category:  data.category,
      title:     data.title,
      body:      data.body,
      excerpt:   data.excerpt ?? null,
      createdBy: adminId,
    },
  });
  return adminGetContent(row.id);
}

// ── Update ─────────────────────────────────────────────────────────────────────

export async function adminUpdateContent(id: string, data: {
  title?:   string;
  body?:    string;
  excerpt?: string | null;
  slug?:    string;
}, adminId: string): Promise<ContentPostDetail> {
  const existing = await db.contentPost.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Content post not found"), { statusCode: 404 });

  if (data.slug && data.slug !== existing.slug) {
    const slugConflict = await db.contentPost.findUnique({ where: { slug: data.slug } });
    if (slugConflict) throw Object.assign(new Error("Slug already in use"), { statusCode: 409 });
  }

  await db.contentPost.update({
    where: { id },
    data: {
      ...(data.title   !== undefined && { title:   data.title }),
      ...(data.body    !== undefined && { body:    data.body }),
      ...(data.excerpt !== undefined && { excerpt: data.excerpt }),
      ...(data.slug    !== undefined && { slug:    data.slug }),
      updatedBy: adminId,
    },
  });
  return adminGetContent(id);
}

// ── Publish / Unpublish ────────────────────────────────────────────────────────

export async function adminPublishContent(id: string, adminId: string): Promise<ContentPostDetail> {
  const existing = await db.contentPost.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Content post not found"), { statusCode: 404 });
  await db.contentPost.update({
    where: { id },
    data: { status: "published", publishedAt: existing.publishedAt ?? new Date(), updatedBy: adminId },
  });
  return adminGetContent(id);
}

export async function adminUnpublishContent(id: string, adminId: string): Promise<ContentPostDetail> {
  const existing = await db.contentPost.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Content post not found"), { statusCode: 404 });
  await db.contentPost.update({
    where: { id },
    data: { status: "draft", updatedBy: adminId },
  });
  return adminGetContent(id);
}

// ── Delete ─────────────────────────────────────────────────────────────────────

export async function adminDeleteContent(id: string): Promise<{ deleted: boolean }> {
  const existing = await db.contentPost.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Content post not found"), { statusCode: 404 });
  await db.contentPost.delete({ where: { id } });
  return { deleted: true };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
