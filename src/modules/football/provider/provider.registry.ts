/**
 * Provider registry — maps provider type strings to adapter constructors.
 * To add a new provider: implement ProviderAdapter, add it here, done.
 */

import { ProviderAdapter } from "./provider.interface";
import { FootballDataProvider } from "./providers/football-data.provider";
import { ApiFootballProvider }  from "./providers/api-football.provider";

export const PROVIDER_TYPES = [
  {
    type:           "football-data",
    name:           "Football-Data.org",
    defaultBaseUrl: "https://api.football-data.org/v4",
    docsUrl:        "https://www.football-data.org/documentation/quickstart",
    rateLimit:      10,
    freeQuota:      "10 requests/minute, 12 competitions",
  },
  {
    type:           "api-football",
    name:           "API-Football",
    defaultBaseUrl: "https://v3.football.api-sports.io",
    docsUrl:        "https://www.api-football.com/documentation-v3",
    rateLimit:      30,
    freeQuota:      "100 requests/day",
  },
] as const;

export type ProviderTypeName = (typeof PROVIDER_TYPES)[number]["type"];

export function createProviderAdapter(
  type:     string,
  apiKey:   string,
  baseUrl?: string,
): ProviderAdapter {
  switch (type as ProviderTypeName) {
    case "football-data":
      return new FootballDataProvider(apiKey, baseUrl);
    case "api-football":
      return new ApiFootballProvider(apiKey, baseUrl);
    default:
      throw new Error(`Unknown provider type: "${type}". Supported: ${PROVIDER_TYPES.map(p => p.type).join(", ")}`);
  }
}
