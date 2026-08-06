/**
 * Language Management Service — Phase 24.2
 *
 * Manages the Language table — the backend-authoritative list of
 * platform languages. Admin can add/edit/enable/disable/reorder/delete.
 *
 * Rules:
 *  - English (code "en") cannot be deleted (it is the fallback base).
 *  - Only one language may be isDefault=true at any time.
 *  - Changing default clears isDefault on all others first.
 */
import { db } from "../../../db";

export interface LanguageRow {
  code:       string;
  name:       string;
  nativeName: string;
  flag:       string | null;
  direction:  string;
  isDefault:  boolean;
  isEnabled:  boolean;
  sortOrder:  number;
  createdAt:  string;
  updatedAt:  string;
}

function serialise(row: any): LanguageRow {
  return {
    code:       row.code,
    name:       row.name,
    nativeName: row.nativeName,
    flag:       row.flag ?? null,
    direction:  row.direction,
    isDefault:  row.isDefault,
    isEnabled:  row.isEnabled,
    sortOrder:  row.sortOrder,
    createdAt:  row.createdAt.toISOString(),
    updatedAt:  row.updatedAt.toISOString(),
  };
}

export async function listAllLanguages(): Promise<LanguageRow[]> {
  const rows = await db.language.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map(serialise);
}

export async function listEnabledLanguages(): Promise<LanguageRow[]> {
  const rows = await db.language.findMany({
    where: { isEnabled: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(serialise);
}

export async function getDefaultLanguage(): Promise<LanguageRow | null> {
  const row = await db.language.findFirst({ where: { isDefault: true } });
  return row ? serialise(row) : null;
}

export async function getLanguage(code: string): Promise<LanguageRow | null> {
  const row = await db.language.findUnique({ where: { code } });
  return row ? serialise(row) : null;
}

export async function createLanguage(data: {
  code: string; name: string; nativeName: string; flag?: string;
  direction?: string; isEnabled?: boolean; sortOrder?: number;
}): Promise<LanguageRow> {
  const row = await db.language.create({
    data: {
      code:       data.code.toLowerCase().trim(),
      name:       data.name.trim(),
      nativeName: (data.nativeName ?? data.name).trim(),
      flag:       data.flag ?? null,
      direction:  data.direction ?? "ltr",
      isDefault:  false,
      isEnabled:  data.isEnabled ?? true,
      sortOrder:  data.sortOrder ?? 0,
    },
  });
  // Kick off auto-translation in background (non-blocking)
  setImmediate(async () => {
    try {
      const { autoTranslateLanguage } = await import("../translation/admin.translation.service");
      const fullLang = await import("../../../db").then(m => m.db.language.findUnique({ where: { code: row.code } }));
      if (fullLang && fullLang.code !== "en") {
        await autoTranslateLanguage(fullLang.code, fullLang.name, true);
        console.log(`[Language] Auto-translated new language: ${fullLang.code}`);
      }
    } catch (e) {
      console.error(`[Language] Auto-translate failed for ${row.code}:`, e);
    }
  });
  return serialise(row);
}

export async function updateLanguage(code: string, data: {
  name?: string; nativeName?: string; flag?: string | null;
  direction?: string; isDefault?: boolean; isEnabled?: boolean; sortOrder?: number;
}): Promise<LanguageRow> {
  // Setting as default: clear isDefault on all others first
  if (data.isDefault === true) {
    await db.language.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }
  const row = await db.language.update({
    where: { code },
    data: {
      ...(data.name       !== undefined && { name:       data.name.trim() }),
      ...(data.nativeName !== undefined && { nativeName: data.nativeName.trim() }),
      ...(data.flag       !== undefined && { flag:       data.flag }),
      ...(data.direction  !== undefined && { direction:  data.direction }),
      ...(data.isDefault  !== undefined && { isDefault:  data.isDefault }),
      ...(data.isEnabled  !== undefined && { isEnabled:  data.isEnabled }),
      ...(data.sortOrder  !== undefined && { sortOrder:  data.sortOrder }),
    },
  });
  return serialise(row);
}

export async function deleteLanguage(code: string): Promise<void> {
  if (code === "en") throw new Error("English cannot be deleted — it is the fallback base language.");
  const lang = await db.language.findUnique({ where: { code } });
  if (!lang) throw new Error(`Language "${code}" not found.`);
  if (lang.isDefault) throw new Error("Cannot delete the default language. Set another language as default first.");
  await db.language.delete({ where: { code } });
}

// ── Seeding ────────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGES = [
  { code: "en", name: "English",    nativeName: "English",    flag: "🇬🇧", direction: "ltr", isDefault: true,  isEnabled: true,  sortOrder: 0  },
  { code: "fr", name: "French",     nativeName: "Français",   flag: "🇫🇷", direction: "ltr", isDefault: false, isEnabled: true,  sortOrder: 1  },
  { code: "es", name: "Spanish",    nativeName: "Español",    flag: "🇪🇸", direction: "ltr", isDefault: false, isEnabled: true,  sortOrder: 2  },
  { code: "pt", name: "Portuguese", nativeName: "Português",  flag: "🇧🇷", direction: "ltr", isDefault: false, isEnabled: true,  sortOrder: 3  },
  { code: "ar", name: "Arabic",     nativeName: "العربية",    flag: "🇸🇦", direction: "rtl", isDefault: false, isEnabled: false, sortOrder: 4  },
  { code: "yo", name: "Yoruba",     nativeName: "Yorùbá",     flag: "🇳🇬", direction: "ltr", isDefault: false, isEnabled: true,  sortOrder: 5  },
  { code: "ig", name: "Igbo",       nativeName: "Igbo",       flag: "🇳🇬", direction: "ltr", isDefault: false, isEnabled: true,  sortOrder: 6  },
  { code: "ha", name: "Hausa",      nativeName: "Hausa",      flag: "🇳🇬", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 7  },
  { code: "sw", name: "Swahili",    nativeName: "Kiswahili",  flag: "🇰🇪", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 8  },
  { code: "de", name: "German",     nativeName: "Deutsch",    flag: "🇩🇪", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 9  },
  { code: "it", name: "Italian",    nativeName: "Italiano",   flag: "🇮🇹", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 10 },
  { code: "ru", name: "Russian",    nativeName: "Русский",    flag: "🇷🇺", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 11 },
  { code: "zh", name: "Chinese",    nativeName: "中文",        flag: "🇨🇳", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 12 },
  { code: "hi", name: "Hindi",      nativeName: "हिन्दी",     flag: "🇮🇳", direction: "ltr", isDefault: false, isEnabled: false, sortOrder: 13 },
  { code: "he", name: "Hebrew",     nativeName: "עברית",      flag: "🇮🇱", direction: "rtl", isDefault: false, isEnabled: false, sortOrder: 14 },
  { code: "fa", name: "Persian",    nativeName: "فارسی",      flag: "🇮🇷", direction: "rtl", isDefault: false, isEnabled: false, sortOrder: 15 },
];

export async function seedDefaultLanguages(): Promise<void> {
  for (const lang of DEFAULT_LANGUAGES) {
    await db.language.upsert({
      where:  { code: lang.code },
      create: lang,
      update: {},  // never overwrite admin changes
    });
  }
}
