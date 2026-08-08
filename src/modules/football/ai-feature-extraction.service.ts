/**
 * AI Feature Extraction Service — Phase 17.2
 *
 * Extracts statistical features for a football match from the BitZimi database ONLY.
 * No external football providers are used. All data comes from finished matches
 * already recorded in football_matches with homeScore/awayScore populated.
 *
 * Features extracted:
 *   - Home team venue form (last 8 home matches as home)
 *   - Away team venue form (last 8 away matches as away)
 *   - Home team overall recent form (last 10 any-venue matches)
 *   - Away team overall recent form (last 10 any-venue matches)
 *   - Head-to-head history between the two sides (last 10 meetings)
 *   - Per-team: wins, draws, losses, goals, win%, draw%, loss%, BTTS%, avg goals
 *   - H2H: home wins, draws, away wins, avg goals, BTTS rate
 *   - Data quality rating: none / low / medium / high
 */

import { db } from "../../db";

// ── Public types ──────────────────────────────────────────────────────────────

export type MatchResult = "W" | "D" | "L";

export interface FormMatch {
  opponent:     string;
  isHome:       boolean;
  goalsFor:     number;
  goalsAgainst: number;
  result:       MatchResult;
  date:         Date;
}

export interface TeamForm {
  matches:           FormMatch[];
  wins:              number;
  draws:             number;
  losses:            number;
  goalsScored:       number;
  goalsConceded:     number;
  winRate:           number; // 0–1
  drawRate:          number;
  lossRate:          number;
  avgGoalsScored:    number;
  avgGoalsConceded:  number;
  goalDifference:    number;
  bttsMatches:       number;
  bttsRate:          number; // 0–1
  cleanSheets:       number;
  formString:        string; // e.g. "WWDLW" — last 5 results newest-first
}

export interface H2HRecord {
  totalMatches:  number;
  homeWins:      number; // wins for the current match's home team
  draws:         number;
  awayWins:      number; // wins for the current match's away team
  avgGoals:      number;
  bttsRate:      number;
  recentMatches: FormMatch[];
}

export interface MatchFeatures {
  homeTeam:        string;
  awayTeam:        string;
  leagueName:      string;
  homeVenueForm:   TeamForm; // home team last 8 as home team
  awayVenueForm:   TeamForm; // away team last 8 as away team
  homeOverallForm: TeamForm; // home team last 10 any venue
  awayOverallForm: TeamForm; // away team last 10 any venue
  h2h:             H2HRecord;
  dataQuality:     "high" | "medium" | "low" | "none";
  totalDataPoints: number;
}

// ── Internal raw DB type ──────────────────────────────────────────────────────

interface RawMatch {
  homeTeam:  string;
  awayTeam:  string;
  homeScore: number;
  awayScore: number;
  kickoffAt: Date;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function result(isHome: boolean, gf: number, ga: number): MatchResult {
  if (gf > ga) return "W";
  if (gf < ga) return "L";
  return "D";
}

function toFormMatch(raw: RawMatch, perspectiveTeam: string): FormMatch {
  const isHome      = raw.homeTeam === perspectiveTeam;
  const goalsFor    = isHome ? raw.homeScore : raw.awayScore;
  const goalsAgainst = isHome ? raw.awayScore : raw.homeScore;
  return {
    opponent:     isHome ? raw.awayTeam : raw.homeTeam,
    isHome,
    goalsFor,
    goalsAgainst,
    result:       result(isHome, goalsFor, goalsAgainst),
    date:         raw.kickoffAt,
  };
}

function aggregateForm(matches: FormMatch[]): TeamForm {
  const n = matches.length;
  if (n === 0) {
    return {
      matches: [], wins: 0, draws: 0, losses: 0,
      goalsScored: 0, goalsConceded: 0, goalDifference: 0,
      winRate: 0, drawRate: 0, lossRate: 0,
      avgGoalsScored: 0, avgGoalsConceded: 0,
      bttsMatches: 0, bttsRate: 0, cleanSheets: 0,
      formString: "",
    };
  }
  const wins        = matches.filter(m => m.result === "W").length;
  const draws       = matches.filter(m => m.result === "D").length;
  const losses      = matches.filter(m => m.result === "L").length;
  const goalsScored    = matches.reduce((s, m) => s + m.goalsFor, 0);
  const goalsConceded  = matches.reduce((s, m) => s + m.goalsAgainst, 0);
  const bttsMatches    = matches.filter(m => m.goalsFor > 0 && m.goalsAgainst > 0).length;
  const cleanSheets    = matches.filter(m => m.goalsAgainst === 0).length;
  return {
    matches,
    wins, draws, losses,
    goalsScored, goalsConceded,
    goalDifference:    goalsScored - goalsConceded,
    winRate:           wins   / n,
    drawRate:          draws  / n,
    lossRate:          losses / n,
    avgGoalsScored:    goalsScored   / n,
    avgGoalsConceded:  goalsConceded / n,
    bttsMatches,
    bttsRate:          bttsMatches / n,
    cleanSheets,
    formString:        matches.slice(0, 5).map(m => m.result).join(""),
  };
}

function dataQuality(totalDataPoints: number): MatchFeatures["dataQuality"] {
  if (totalDataPoints >= 20) return "high";
  if (totalDataPoints >= 10) return "medium";
  if (totalDataPoints >= 4)  return "low";
  return "none";
}

// ── Main extractor ────────────────────────────────────────────────────────────

export async function extractMatchFeatures(matchId: string): Promise<MatchFeatures> {
  const match = await db.footballMatch.findUnique({
    where:   { id: matchId },
    include: { league: { select: { name: true } } },
  });
  if (!match) throw Object.assign(new Error(`Match ${matchId} not found`), { statusCode: 404 });

  const { homeTeam, awayTeam } = match;
  const leagueName = match.league.name;

  // Selector for rows with recorded scores
  const scoreFilter = { homeScore: { not: null }, awayScore: { not: null } };
  const exclude     = { id: { not: matchId } };
  const finished    = { status: "finished" };

  // Parallel DB reads for maximum performance
  const [homeVenueRaw, awayVenueRaw, homeAllRaw, awayAllRaw, h2hRaw] = await Promise.all([
    // Home team last 8 home matches (as home)
    db.footballMatch.findMany({
      where:   { homeTeam, ...finished, ...scoreFilter, ...exclude },
      orderBy: { kickoffAt: "desc" },
      take:    8,
      select:  { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, kickoffAt: true },
    }),
    // Away team last 8 away matches (as away)
    db.footballMatch.findMany({
      where:   { awayTeam, ...finished, ...scoreFilter, ...exclude },
      orderBy: { kickoffAt: "desc" },
      take:    8,
      select:  { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, kickoffAt: true },
    }),
    // Home team last 10 any-venue
    db.footballMatch.findMany({
      where:   { OR: [{ homeTeam }, { awayTeam: homeTeam }], ...finished, ...scoreFilter, ...exclude },
      orderBy: { kickoffAt: "desc" },
      take:    10,
      select:  { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, kickoffAt: true },
    }),
    // Away team last 10 any-venue
    db.footballMatch.findMany({
      where:   { OR: [{ homeTeam: awayTeam }, { awayTeam }], ...finished, ...scoreFilter, ...exclude },
      orderBy: { kickoffAt: "desc" },
      take:    10,
      select:  { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, kickoffAt: true },
    }),
    // H2H last 10 (both directions)
    db.footballMatch.findMany({
      where: {
        OR: [
          { homeTeam, awayTeam },
          { homeTeam: awayTeam, awayTeam: homeTeam },
        ],
        ...finished, ...scoreFilter, ...exclude,
      },
      orderBy: { kickoffAt: "desc" },
      take:    10,
      select:  { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, kickoffAt: true },
    }),
  ]);

  // Normalise null scores (Prisma returns them as null but we filtered above)
  const norm = (r: typeof homeVenueRaw[0]): RawMatch => ({
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    homeScore: r.homeScore ?? 0,
    awayScore: r.awayScore ?? 0,
    kickoffAt: r.kickoffAt,
  });

  const homeVenueForm   = aggregateForm(homeVenueRaw.map(r => toFormMatch(norm(r), homeTeam)));
  const awayVenueForm   = aggregateForm(awayVenueRaw.map(r => toFormMatch(norm(r), awayTeam)));
  const homeOverallForm = aggregateForm(homeAllRaw.map(r  => toFormMatch(norm(r), homeTeam)));
  const awayOverallForm = aggregateForm(awayAllRaw.map(r  => toFormMatch(norm(r), awayTeam)));

  // H2H from home team's perspective
  const h2hForms  = h2hRaw.map(r => toFormMatch(norm(r), homeTeam));
  const h2hWins   = h2hForms.filter(m => m.result === "W").length;
  const h2hDraws  = h2hForms.filter(m => m.result === "D").length;
  const h2hLosses = h2hForms.filter(m => m.result === "L").length;
  const h2hTotalGoals = h2hForms.reduce((s, m) => s + m.goalsFor + m.goalsAgainst, 0);
  const h2hBtts = h2hForms.filter(m => m.goalsFor > 0 && m.goalsAgainst > 0).length;

  const h2h: H2HRecord = {
    totalMatches:  h2hForms.length,
    homeWins:      h2hWins,
    draws:         h2hDraws,
    awayWins:      h2hLosses, // losses for home team = wins for away team
    avgGoals:      h2hForms.length > 0 ? h2hTotalGoals / h2hForms.length : 0,
    bttsRate:      h2hForms.length > 0 ? h2hBtts / h2hForms.length : 0,
    recentMatches: h2hForms.slice(0, 5),
  };

  const totalDataPoints =
    homeVenueRaw.length + awayVenueRaw.length +
    homeAllRaw.length   + awayAllRaw.length   +
    h2hRaw.length;

  return {
    homeTeam, awayTeam, leagueName,
    homeVenueForm, awayVenueForm,
    homeOverallForm, awayOverallForm,
    h2h,
    dataQuality:     dataQuality(totalDataPoints),
    totalDataPoints,
  };
}
