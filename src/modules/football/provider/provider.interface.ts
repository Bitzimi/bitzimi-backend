/**
 * Provider abstraction — all external football data providers implement this interface.
 * Add new providers by implementing ProviderAdapter and registering in provider.registry.ts.
 */

export interface ProviderLeague {
  externalId:  string;
  name:        string;
  country:     string;
  logoUrl?:    string;
}

export interface ProviderFixture {
  externalId:        string;
  leagueExternalId:  string;
  homeTeam:          string;
  awayTeam:          string;
  kickoffAt:         Date;
  status:            "upcoming" | "live" | "finished" | "postponed" | "cancelled";
  homeScore?:        number;
  awayScore?:        number;
  minutePlayed?:     number;
}

export interface ProviderHealth {
  healthy:           boolean;
  latencyMs:         number;
  error?:            string;
  quotaUsed?:        number;
  quotaRemaining?:   number;
}

export interface ProviderAdapter {
  readonly type: string;
  readonly name: string;

  /** Ping the provider — returns latency and quota info. */
  checkHealth(): Promise<ProviderHealth>;

  /** Fetch available competitions/leagues from the provider. */
  fetchLeagues(): Promise<ProviderLeague[]>;

  /**
   * Fetch scheduled and in-play fixtures for a league within a date window.
   * `leagueExternalId` is the provider's own league identifier.
   */
  fetchFixtures(leagueExternalId: string, from: Date, to: Date): Promise<ProviderFixture[]>;

  /** Fetch currently live fixtures across all leagues. */
  fetchLiveFixtures(): Promise<ProviderFixture[]>;

  /**
   * Fetch completed fixtures with final scores for a league within a date window.
   */
  fetchResults(leagueExternalId: string, from: Date, to: Date): Promise<ProviderFixture[]>;
}
