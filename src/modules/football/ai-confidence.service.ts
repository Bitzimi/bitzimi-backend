/**
 * AI Confidence Engine — Phase 17.2
 *
 * Converts extracted match features into confidence scores for each betting market.
 * Uses the configurable feature weights from AIEngineConfig.
 *
 * Markets scored:
 *   1X2          — home win / draw / away win
 *   btts         — both teams to score yes / no
 *   over_under   — over 2.5 goals / under 2.5 goals
 *   double_chance — 1X (home or draw) / 12 (either team wins) / X2 (draw or away)
 *
 * ALL probability maths runs here on the backend.
 * The frontend receives pre-computed values — it does not calculate anything.
 */

import type { MatchFeatures } from "./ai-feature-extraction.service";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarketOutcome {
  prediction:  string;
  probability: number; // raw 0–1
  confidence:  number; // integer 0–100
}

export interface ConfidenceData {
  overall: number; // integer 0–100
  markets: {
    "1X2":           { home: MarketOutcome; draw: MarketOutcome; away: MarketOutcome };
    "btts":          { yes:  MarketOutcome; no:   MarketOutcome };
    "over_under":    { over: MarketOutcome; under: MarketOutcome };
    "double_chance": { "1X": MarketOutcome; "12": MarketOutcome; "X2": MarketOutcome };
  };
  suggestedMarket:     string;
  suggestedPrediction: string;
  suggestedConfidence: number;
  suggestedRiskLevel:  "low" | "medium" | "high";
  suggestedIsVip:      boolean;
  dataQuality:         string;
}

// ── Football historical priors (rough global rates) ───────────────────────────

const PRIOR_HOME = 0.45;
const PRIOR_DRAW = 0.27;
const PRIOR_AWAY = 0.28;
const PRIOR_BTTS = 0.50;
const PRIOR_OVER = 0.52;

// ── Utilities ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function toConf(prob: number): number {
  return Math.round(clamp(prob) * 100);
}

function normalise(vals: number[]): number[] {
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum === 0) return vals.map(() => 1 / vals.length);
  return vals.map(v => v / sum);
}

function riskLevel(conf: number, high: number, min: number): "low" | "medium" | "high" {
  if (conf >= high) return "low";
  if (conf >= min)  return "medium";
  return "high";
}

// ── 1X2 model ─────────────────────────────────────────────────────────────────
//
// Starting from historical priors, adjust based on:
//   1. Home venue win rate (weighted by homeForm weight)
//   2. Away venue win rate (weighted by awayForm weight)
//   3. H2H record        (weighted by h2h weight)
//   4. Home venue advantage bonus (weighted by venueAdvantage weight)
// leagueStrength is symmetric so it does not shift 1X2 direction here.

function compute1X2(
  f: MatchFeatures,
  weights: Record<string, number>,
): { home: number; draw: number; away: number } {
  const wHome  = weights["homeForm"]       ?? 0.30;
  const wAway  = weights["awayForm"]       ?? 0.25;
  const wH2H   = weights["h2h"]            ?? 0.20;
  const wVenue = weights["venueAdvantage"] ?? 0.10;

  let homeStrength = PRIOR_HOME;
  let awayStrength = PRIOR_AWAY;

  // Venue form — blend venue-specific and overall, venue-specific is more predictive
  const homeFormScore = f.homeVenueForm.matches.length >= 3
    ? f.homeVenueForm.winRate  * 0.7 + f.homeOverallForm.winRate * 0.3
    : f.homeOverallForm.winRate;

  const awayFormScore = f.awayVenueForm.matches.length >= 3
    ? f.awayVenueForm.winRate  * 0.7 + f.awayOverallForm.winRate * 0.3
    : f.awayOverallForm.winRate;

  // Adjust strength from neutral (0.5) by observed form
  homeStrength += (homeFormScore - 0.5) * wHome;
  awayStrength += (awayFormScore - 0.5) * wAway;

  // H2H adjustment
  if (f.h2h.totalMatches >= 2) {
    const h2hHomeRate = f.h2h.homeWins / f.h2h.totalMatches;
    const h2hAwayRate = f.h2h.awayWins / f.h2h.totalMatches;
    homeStrength += (h2hHomeRate - 0.40) * wH2H;
    awayStrength += (h2hAwayRate - 0.30) * wH2H;
  }

  // Home venue advantage (structural bonus for playing at home)
  homeStrength += wVenue * 0.5;

  const rawHome = clamp(homeStrength, 0.10, 0.85);
  const rawAway = clamp(awayStrength, 0.08, 0.75);
  // Draw is residual — dampened when one side dominates
  const rawDraw = clamp(1 - rawHome - rawAway + 0.08, 0.08, 0.42);

  const [home, draw, away] = normalise([rawHome, rawDraw, rawAway]);
  return { home, draw, away };
}

// ── BTTS model ────────────────────────────────────────────────────────────────

function computeBTTS(f: MatchFeatures): number {
  const homeBTTS = f.homeVenueForm.matches.length >= 3
    ? f.homeVenueForm.bttsRate
    : PRIOR_BTTS;
  const awayBTTS = f.awayVenueForm.matches.length >= 3
    ? f.awayVenueForm.bttsRate
    : PRIOR_BTTS;
  const h2hBTTS = f.h2h.totalMatches >= 2
    ? f.h2h.bttsRate
    : PRIOR_BTTS;

  // Weighted blend
  return clamp(homeBTTS * 0.35 + awayBTTS * 0.35 + h2hBTTS * 0.30);
}

// ── Over/Under 2.5 model ──────────────────────────────────────────────────────

function computeOverUnder(f: MatchFeatures): number {
  const homeAvgScored = f.homeVenueForm.matches.length >= 3
    ? f.homeVenueForm.avgGoalsScored
    : 1.3;
  const awayAvgScored = f.awayVenueForm.matches.length >= 3
    ? f.awayVenueForm.avgGoalsScored
    : 1.1;
  const h2hAvg = f.h2h.totalMatches >= 2
    ? f.h2h.avgGoals
    : 2.4;

  // Expected total goals in this match
  const expectedGoals = (homeAvgScored + awayAvgScored) * 0.5 * 0.60 + h2hAvg * 0.40;

  // Sigmoid mapping expected goals → P(over 2.5)
  const overProb = 1 / (1 + Math.exp(-1.5 * (expectedGoals - 2.5)));
  return clamp(overProb);
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function computeConfidence(
  features: MatchFeatures,
  weights: Record<string, number>,
  thresholds: { minConfidence: number; highConfidence: number },
): ConfidenceData {
  const { minConfidence, highConfidence } = thresholds;

  // 1X2
  const { home: pH, draw: pD, away: pA } = compute1X2(features, weights);
  const markets1X2 = {
    home: { prediction: "home", probability: pH, confidence: toConf(pH) },
    draw: { prediction: "draw", probability: pD, confidence: toConf(pD) },
    away: { prediction: "away", probability: pA, confidence: toConf(pA) },
  };

  // BTTS
  const pBttsYes = computeBTTS(features);
  const marketsBTTS = {
    yes: { prediction: "yes", probability: pBttsYes,      confidence: toConf(pBttsYes) },
    no:  { prediction: "no",  probability: 1 - pBttsYes,  confidence: toConf(1 - pBttsYes) },
  };

  // Over/Under
  const pOver = computeOverUnder(features);
  const marketsOU = {
    over:  { prediction: "over",  probability: pOver,       confidence: toConf(pOver) },
    under: { prediction: "under", probability: 1 - pOver,   confidence: toConf(1 - pOver) },
  };

  // Double Chance (combinations)
  const p1X = clamp(pH + pD);
  const p12 = clamp(pH + pA);
  const pX2 = clamp(pD + pA);
  const marketsDC = {
    "1X": { prediction: "1X", probability: p1X, confidence: toConf(p1X) },
    "12": { prediction: "12", probability: p12, confidence: toConf(p12) },
    "X2": { prediction: "X2", probability: pX2, confidence: toConf(pX2) },
  };

  // Find best suggestion across all markets (highest confidence at or above min threshold)
  const candidates: Array<{ market: string; prediction: string; confidence: number }> = [
    { market: "1X2",           prediction: "home",  confidence: markets1X2.home.confidence },
    { market: "1X2",           prediction: "draw",  confidence: markets1X2.draw.confidence },
    { market: "1X2",           prediction: "away",  confidence: markets1X2.away.confidence },
    { market: "btts",          prediction: "yes",   confidence: marketsBTTS.yes.confidence  },
    { market: "btts",          prediction: "no",    confidence: marketsBTTS.no.confidence   },
    { market: "over_under",    prediction: "over",  confidence: marketsOU.over.confidence   },
    { market: "over_under",    prediction: "under", confidence: marketsOU.under.confidence  },
    { market: "double_chance", prediction: "1X",    confidence: marketsDC["1X"].confidence  },
    { market: "double_chance", prediction: "12",    confidence: marketsDC["12"].confidence  },
    { market: "double_chance", prediction: "X2",    confidence: marketsDC["X2"].confidence  },
  ];

  const eligible = candidates.filter(c => c.confidence >= minConfidence);
  const best = eligible.length > 0
    ? eligible.reduce((a, b) => a.confidence >= b.confidence ? a : b)
    : candidates.reduce((a, b) => a.confidence >= b.confidence ? a : b);

  const suggestedConfidence = best.confidence;
  const suggestedIsVip      = suggestedConfidence >= highConfidence;

  return {
    overall:  suggestedConfidence,
    markets: {
      "1X2":           markets1X2,
      "btts":          marketsBTTS,
      "over_under":    marketsOU,
      "double_chance": marketsDC,
    },
    suggestedMarket:     best.market,
    suggestedPrediction: best.prediction,
    suggestedConfidence,
    suggestedRiskLevel:  riskLevel(suggestedConfidence, highConfidence, minConfidence),
    suggestedIsVip,
    dataQuality:         features.dataQuality,
  };
}
