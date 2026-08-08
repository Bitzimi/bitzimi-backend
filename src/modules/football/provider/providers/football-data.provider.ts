/**
 * Football-Data.org adapter — https://www.football-data.org/documentation/quickstart
 *
 * Free tier: 10 requests/minute, 12 competitions.
 * Set X-Auth-Token header with your API token.
 */

import { ProviderAdapter, ProviderFixture, ProviderHealth, ProviderLeague } from "../provider.interface";

const STATUS_MAP: Record<string, ProviderFixture["status"]> = {
  TIMED:     "upcoming",
  SCHEDULED: "upcoming",
  LIVE:      "live",
  IN_PLAY:   "live",
  PAUSED:    "live",
  FINISHED:  "finished",
  POSTPONED: "postponed",
  SUSPENDED: "postponed",
  CANCELLED: "cancelled",
};

interface FDCompetition {
  id:     number;
  name:   string;
  area:   { name: string };
  emblem?: string;
}

interface FDMatch {
  id:          number;
  utcDate:     string;
  status:      string;
  competition: { id: number };
  homeTeam:    { name: string };
  awayTeam:    { name: string };
  score:       { fullTime: { home: number | null; away: number | null } };
}

export class FootballDataProvider implements ProviderAdapter {
  readonly type = "football-data";
  readonly name = "Football-Data.org";

  constructor(
    private readonly apiKey:  string,
    private readonly baseUrl: string = "https://api.football-data.org/v4",
  ) {}

  private async fetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "X-Auth-Token": this.apiKey },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Football-Data API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async checkHealth(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.fetch("/competitions");
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e: unknown) {
      return { healthy: false, latencyMs: Date.now() - start, error: (e as Error).message };
    }
  }

  async fetchLeagues(): Promise<ProviderLeague[]> {
    const data = await this.fetch<{ competitions: FDCompetition[] }>("/competitions");
    return data.competitions.map(c => ({
      externalId: String(c.id),
      name:       c.name,
      country:    c.area.name,
      logoUrl:    c.emblem,
    }));
  }

  async fetchFixtures(leagueExternalId: string, from: Date, to: Date): Promise<ProviderFixture[]> {
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const data = await this.fetch<{ matches: FDMatch[] }>(
      `/competitions/${leagueExternalId}/matches?dateFrom=${fmt(from)}&dateTo=${fmt(to)}`,
    );
    return this._parseMatches(data.matches, leagueExternalId);
  }

  async fetchLiveFixtures(): Promise<ProviderFixture[]> {
    const data = await this.fetch<{ matches: FDMatch[] }>("/matches?status=LIVE,IN_PLAY,PAUSED");
    return this._parseMatches(data.matches);
  }

  async fetchResults(leagueExternalId: string, from: Date, to: Date): Promise<ProviderFixture[]> {
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const data = await this.fetch<{ matches: FDMatch[] }>(
      `/competitions/${leagueExternalId}/matches?status=FINISHED&dateFrom=${fmt(from)}&dateTo=${fmt(to)}`,
    );
    return this._parseMatches(data.matches, leagueExternalId);
  }

  private _parseMatches(matches: FDMatch[], leagueExtId?: string): ProviderFixture[] {
    return matches.map(m => ({
      externalId:       String(m.id),
      leagueExternalId: leagueExtId ?? String(m.competition.id),
      homeTeam:         m.homeTeam.name,
      awayTeam:         m.awayTeam.name,
      kickoffAt:        new Date(m.utcDate),
      status:           STATUS_MAP[m.status] ?? "upcoming",
      homeScore:        m.score.fullTime.home ?? undefined,
      awayScore:        m.score.fullTime.away ?? undefined,
    }));
  }
}
