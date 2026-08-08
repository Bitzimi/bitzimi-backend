/**
 * Minimal User-Agent parser — no external dependencies.
 * Extracts device type, browser, and OS from a User-Agent string.
 */

export interface ParsedUA {
  deviceType: string; // desktop | mobile | tablet | bot | unknown
  browser:    string;
  os:         string;
}

export function parseUserAgent(ua: string): ParsedUA {
  if (!ua) return { deviceType: "unknown", browser: "unknown", os: "unknown" };

  const s = ua.toLowerCase();

  // Device type
  let deviceType = "desktop";
  if      (s.includes("bot") || s.includes("crawler") || s.includes("spider")) deviceType = "bot";
  else if (s.includes("tablet") || s.includes("ipad"))                         deviceType = "tablet";
  else if (s.includes("mobile") || s.includes("android") || s.includes("iphone") || s.includes("ipod")) deviceType = "mobile";

  // Browser
  let browser = "unknown";
  if      (s.includes("edg/") || s.includes("edge/"))    browser = "Edge";
  else if (s.includes("opr/") || s.includes("opera"))    browser = "Opera";
  else if (s.includes("samsungbrowser"))                  browser = "Samsung Browser";
  else if (s.includes("chrome") && !s.includes("chromium")) browser = "Chrome";
  else if (s.includes("chromium"))                        browser = "Chromium";
  else if (s.includes("firefox"))                         browser = "Firefox";
  else if (s.includes("safari") && !s.includes("chrome")) browser = "Safari";
  else if (s.includes("msie") || s.includes("trident"))  browser = "Internet Explorer";
  else if (s.includes("curl"))                            browser = "curl";

  // OS
  let os = "unknown";
  if      (s.includes("windows nt 10"))        os = "Windows 10";
  else if (s.includes("windows nt 11"))        os = "Windows 11";
  else if (s.includes("windows"))              os = "Windows";
  else if (s.includes("mac os x") || s.includes("macos")) os = "macOS";
  else if (s.includes("iphone os"))            os = "iOS";
  else if (s.includes("android"))              os = "Android";
  else if (s.includes("linux"))                os = "Linux";
  else if (s.includes("cros"))                 os = "ChromeOS";

  return { deviceType, browser, os };
}
