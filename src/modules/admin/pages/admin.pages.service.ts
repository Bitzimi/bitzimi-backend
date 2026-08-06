/**
 * Admin Static Pages Service — About, Privacy, Terms, FAQ, Help, etc.
 *
 * isSystem=true pages (legal/core) cannot be deleted.
 * Admins publish/unpublish; the public API returns only published pages.
 */
import { db } from "../../../db";
import { v4 as uuid } from "uuid";

export type PageStatus = "draft" | "published";

export interface StaticPageItem {
  id:        string;
  slug:      string;
  title:     string;
  status:    PageStatus;
  isSystem:  boolean;
  sortOrder: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaticPageDetail extends StaticPageItem {
  body: string;
}

// Default system pages seeded on first boot
const SYSTEM_PAGES = [
  { slug: "about",               title: "About Us",            sortOrder: 1 },
  { slug: "faq",                 title: "Frequently Asked Questions", sortOrder: 2 },
  { slug: "help",                title: "Help Center",          sortOrder: 3 },
  { slug: "contact",             title: "Contact Us",           sortOrder: 4 },
  { slug: "privacy-policy",      title: "Privacy Policy",       sortOrder: 5 },
  { slug: "terms-of-service",    title: "Terms of Service",     sortOrder: 6 },
  { slug: "cookie-policy",       title: "Cookie Policy",        sortOrder: 7 },
  { slug: "community-guidelines",title: "Community Guidelines", sortOrder: 8 },
  { slug: "responsible-gaming",  title: "Responsible Gaming",   sortOrder: 9 },
];

// ── Seed default pages (idempotent) ───────────────────────────────────────────

export async function seedDefaultPages(adminId = "system") {
  for (const page of SYSTEM_PAGES) {
    const existing = await db.staticPage.findUnique({ where: { slug: page.slug } });
    if (!existing) {
      await db.staticPage.create({
        data: {
          id:        uuid(),
          slug:      page.slug,
          title:     page.title,
          body:      `# ${page.title}\n\nContent coming soon.`,
          status:    "draft",
          isSystem:  true,
          sortOrder: page.sortOrder,
          createdBy: adminId,
        },
      });
    }
  }
}

// ── List ───────────────────────────────────────────────────────────────────────

export async function adminListPages(opts: {
  status?: PageStatus;
  search?: string;
}) {
  const { status, search } = opts;

  const where: any = {};
  if (status) where.status = status;
  if (search?.trim()) {
    where.OR = [
      { title: { contains: search.trim() } },
      { slug:  { contains: search.trim() } },
    ];
  }

  const rows = await db.staticPage.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, slug: true, title: true, status: true, isSystem: true,
      sortOrder: true, createdBy: true, updatedBy: true, createdAt: true, updatedAt: true,
    },
  });

  return rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })) as StaticPageItem[];
}

// ── Get one ────────────────────────────────────────────────────────────────────

export async function adminGetPage(id: string): Promise<StaticPageDetail> {
  const row = await db.staticPage.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("Page not found"), { statusCode: 404 });
  return {
    id:        row.id,
    slug:      row.slug,
    title:     row.title,
    body:      row.body,
    status:    row.status as PageStatus,
    isSystem:  row.isSystem,
    sortOrder: row.sortOrder,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Create ─────────────────────────────────────────────────────────────────────

export async function adminCreatePage(data: {
  slug:       string;
  title:      string;
  body:       string;
  sortOrder?: number;
}, adminId: string): Promise<StaticPageDetail> {
  const slug = data.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const existing = await db.staticPage.findUnique({ where: { slug } });
  if (existing) throw Object.assign(new Error("A page with this slug already exists"), { statusCode: 409 });

  const row = await db.staticPage.create({
    data: {
      id:        uuid(),
      slug,
      title:     data.title,
      body:      data.body,
      isSystem:  false,
      sortOrder: data.sortOrder ?? 99,
      createdBy: adminId,
    },
  });
  return adminGetPage(row.id);
}

// ── Update ─────────────────────────────────────────────────────────────────────

export async function adminUpdatePage(id: string, data: {
  title?:     string;
  body?:      string;
  slug?:      string;
  sortOrder?: number;
}, adminId: string): Promise<StaticPageDetail> {
  const existing = await db.staticPage.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Page not found"), { statusCode: 404 });

  if (data.slug && data.slug !== existing.slug) {
    const conflict = await db.staticPage.findUnique({ where: { slug: data.slug } });
    if (conflict) throw Object.assign(new Error("Slug already in use"), { statusCode: 409 });
  }

  await db.staticPage.update({
    where: { id },
    data: {
      ...(data.title     !== undefined && { title:     data.title }),
      ...(data.body      !== undefined && { body:      data.body }),
      ...(data.slug      !== undefined && { slug:      data.slug }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      updatedBy: adminId,
    },
  });
  return adminGetPage(id);
}

// ── Publish / Unpublish ────────────────────────────────────────────────────────

export async function adminPublishPage(id: string, adminId: string): Promise<StaticPageDetail> {
  const existing = await db.staticPage.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Page not found"), { statusCode: 404 });
  await db.staticPage.update({ where: { id }, data: { status: "published", updatedBy: adminId } });
  return adminGetPage(id);
}

export async function adminUnpublishPage(id: string, adminId: string): Promise<StaticPageDetail> {
  const existing = await db.staticPage.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Page not found"), { statusCode: 404 });
  await db.staticPage.update({ where: { id }, data: { status: "draft", updatedBy: adminId } });
  return adminGetPage(id);
}

// ── Delete ─────────────────────────────────────────────────────────────────────

export async function adminDeletePage(id: string): Promise<{ deleted: boolean }> {
  const existing = await db.staticPage.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Page not found"), { statusCode: 404 });
  if (existing.isSystem) throw Object.assign(new Error("System pages cannot be deleted"), { statusCode: 403 });
  await db.staticPage.delete({ where: { id } });
  return { deleted: true };
}
