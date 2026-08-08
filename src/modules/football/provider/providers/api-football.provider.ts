/**
 * API-Football adapter — https://www.api-football.com/documentation-v3
 *
 * Supports RapidAPI (x-rapidapi-key) or direct API (x-apisports-key).
 * Free tier: 100 requests/day.
 */

import { ProviderAdapter, ProviderFixture, ProviderHealth, ProviderLeague } from "../provider.interface";

const STATUS_MAP: Record<string, ProviderFixture["status"]> = {
  TBD:  "upcoming", NS:   "upcoming",
  "1H": "live",     HT:   "live",   "2H": "live", ET: "live", P: "live", BT: "live",
  FT:   "finished", AET:  "finished", PEN: "finished",
  PST:  "postponed",
  CANC: "cancelled", ABD: "cancelled", WO: "cancelled",
};

interface AFLeague { league: { id: number; name: string; logo?: string }; country: { name: string } }
interface AFFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null } };
  league:  { id: number };
  teams:   { home: { name: string }; away: { name: string } };
  goals:   { home: number | null; away: number | null };
}

export class ApiFootballProvider implements ProviderAdapter {
  readonly type = "api-football";
  readonly name = "API-Football";

  constructor(
    private readonly apiKey:  string,
    private readonly baseUrl: string = "https://v3.football.api-sports.io",
  ) {}

  private async fetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), {
      headers: { "x-apisports-key": this.apiKey },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API-Football ${res.status}: ${text}`);
    }
    const json = await res.json() as { response: T; errors: Record<string, string> };
    if (json.errors && Object.keys(json.errors).length > 0) {
      throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
    }
    return json.response;
  }

  async checkHealth(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.fetch("/status");
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e: unknown) {
      return { healthy: false, latencyMs: Date.now() - start, error: (e as Error).message };
    }
  }

  async fetchLeagues(): Promise<ProviderLeague[]> {
    const leagues = await this.fetch<AFLeague[]>("/leagues");
    return leagues.map(l => ({
      externalId: String(l.league.id),
      name:       l.league.name,
      country:    l.country.name,
      logoUrl:    l.league.logo,
    }));
  }

  async fetchFixtures(leagueExternalId: string, from: Date, to: Date): Promise<ProviderFixture[]> {
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const fixtures = await this.fetch<AFFixture[]>("/fixtures", {
      league: leagueExternalId,
      from:   fmt(from),
      to:     fmt(to),
    });
    return this._parseFixtures(fixtures);
  }

  async fetchLiveFixtures(): Promise<ProviderFixture[]> {
    const fixtures = await this.fetch<AFFixture[]>("/fixtures", { live: "all" });
    return this._parseFixtures(fixtures);
  }

  async fetchResults(leagueExternalId: string, from: Date, to: Date): Promise<ProviderFixture[]> {
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const fixtures = await this.fetch<AFFixture[]>("/fixtures", {
      league: leagueExternalId,
      status: "FT-AET-PEN",
      from:   fmt(from),
      to:     fmt(to),
    });
    return this._parseFixtures(fixtures);
  }

  private _parseFixtures(fixtures: AFFixture[]): ProviderFixture[] {
    return fixtures.map(f => ({
      externalId:       String(f.fixture.id),
      leagueExternalId: String(f.league.id),
      homeTeam:         f.teams.home.name,
      awayTeam:         f.teams.away.name,
      kickoffAt:        new Date(f.fixture.date),
      status:           STATUS_MAP[f.fixture.status.short] ?? "upcoming",
      homeScore:        f.goals.home ?? undefined,
      awayScore:        f.goals.away ?? undefined,
      minutePlayed:     f.fixture.status.elapsed ?? undefined,
    }));
  }
}
