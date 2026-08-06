/**
 * Branding Service — Phase 24.2
 *
 * Reads platform identity configuration from SystemConfig (platform.* keys)
 * and returns a single structured object for the public /api/v1/platform/branding endpoint.
 *
 * No separate DB model needed — everything lives in SystemConfig.
 */
import { getConfigValue } from "../config/admin.config.service";

export interface PlatformBranding {
  name:                string;
  tagline:             string;
  baseUrl:             string;
  supportEmail:        string;
  logoUrl:             string;
  faviconUrl:          string;
  copyrightYear:       string;
  companyName:         string;
  defaultLanguage:     string;
  defaultCurrency:     string;
  registrationEnabled: boolean;
  social: {
    twitter:   string;
    telegram:  string;
    instagram: string;
  };
}

export async function getBranding(): Promise<PlatformBranding> {
  const [
    name, tagline, baseUrl, supportEmail, logoUrl, faviconUrl,
    copyrightYear, companyName, defaultLanguage, defaultCurrency,
    registrationEnabled, twitter, telegram, instagram,
  ] = await Promise.all([
    getConfigValue<string>("platform.name",              "BitZimi"),
    getConfigValue<string>("platform.tagline",           "Play. Earn. Grow."),
    getConfigValue<string>("platform.base_url",          "https://bitzimi.com"),
    getConfigValue<string>("platform.support_email",     "support@bitzimi.com"),
    getConfigValue<string>("platform.logo_url",          ""),
    getConfigValue<string>("platform.favicon_url",       ""),
    getConfigValue<string>("platform.copyright_year",    new Date().getFullYear().toString()),
    getConfigValue<string>("platform.company_name",      "BitZimi Ltd"),
    getConfigValue<string>("platform.default_language",  "en"),
    getConfigValue<string>("platform.default_currency",  "USD"),
    getConfigValue<boolean>("platform.registration_enabled", true),
    getConfigValue<string>("platform.social.twitter",    ""),
    getConfigValue<string>("platform.social.telegram",   ""),
    getConfigValue<string>("platform.social.instagram",  ""),
  ]);

  return {
    name, tagline, baseUrl, supportEmail, logoUrl, faviconUrl,
    copyrightYear, companyName, defaultLanguage, defaultCurrency,
    registrationEnabled,
    social: { twitter, telegram, instagram },
  };
}
