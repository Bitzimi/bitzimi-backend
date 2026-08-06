/**
 * AI Reasoning Engine — Phase 17.2
 *
 * Generates human-readable reasoning and analysis text from extracted features
 * and computed confidence data. All text is template-based and runs on the backend.
 * Stored in AIMatchAnalysis.reasoning (short, 1-2 sentences) and .analysis (full markdown).
 *
 * No LLM or external AI service is used.
 * No text is generated on the frontend.
 */

import type { MatchFeatures } from "./ai-feature-extraction.service";
import type { ConfidenceData } from "./ai-confidence.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(rate: number, decimals = 0): string {
  return (rate * 100).toFixed(decimals) + "%";
}

function formDesc(winRate: number): string {
  if (winRate >= 0.65) return "excellent";
  if (winRate >= 0.45) return "good";
  if (winRate >= 0.30) return "average";
  return "poor";
}

// ── Short reasoning (shown on prediction card) ────────────────────────────────

export function buildReasoning(
  features: MatchFeatures,
  confidence: ConfidenceData,
): string {
  if (features.dataQuality === "none") {
    return (
      `Insufficient historical data for ${features.homeTeam} vs ${features.awayTeam}. ` +
      `Confidence values are based on general football priors only.`
    );
  }

  const { suggestedMarket: mkt, suggestedPrediction: pred, suggestedConfidence: conf } = confidence;
  const hv = features.homeVenueForm;
  const av = features.awayVenueForm;
  const h2h = features.h2h;

  if (mkt === "1X2" && pred === "home") {
    const base = `${features.homeTeam} show ${formDesc(hv.winRate)} home form with a ${pct(hv.winRate)} win rate`;
    const h2hPart = h2h.totalMatches >= 2
      ? ` and lead the H2H ${h2h.homeWins}–${h2h.awayWins}.`
      : ".";
    return `${base}${h2hPart} Home side favoured at ${conf}% confidence.`;
  }

  if (mkt === "1X2" && pred === "away") {
    const base = `${features.awayTeam} have ${formDesc(av.winRate)} away form, winning ${pct(av.winRate)} away`;
    const h2hPart = h2h.totalMatches >= 2
      ? ` and trail ${h2h.homeWins}–${h2h.awayWins} in H2H history.`
      : ".";
    return `${base}${h2hPart} Away side favoured at ${conf}% confidence.`;
  }

  if (mkt === "1X2" && pred === "draw") {
    return (
      `Closely matched sides — ${features.homeTeam} at ${pct(hv.winRate)} home win rate, ` +
      `${features.awayTeam} at ${pct(av.winRate)} away win rate. ` +
      `Draw probability stands at ${confidence.markets["1X2"].draw.confidence}%.`
    );
  }

  if (mkt === "btts") {
    const homeAvg  = hv.avgGoalsScored.toFixed(1);
    const awayAvg  = av.avgGoalsScored.toFixed(1);
    const label    = pred === "yes" ? "Both teams expected to score" : "At least one clean sheet likely";
    return (
      `${features.homeTeam} average ${homeAvg} goals at home; ${features.awayTeam} score ${awayAvg} per game away. ` +
      `${label} (${conf}%).`
    );
  }

  if (mkt === "over_under") {
    const homeAvg = hv.avgGoalsScored.toFixed(1);
    const awayAvg = av.avgGoalsScored.toFixed(1);
    const combined = (parseFloat(homeAvg) + parseFloat(awayAvg)).toFixed(1);
    const label = pred === "over" ? "Over 2.5 goals expected" : "Under 2.5 goals expected";
    return `Combined scoring average of ${combined} goals. ${label} at ${conf}% confidence.`;
  }

  if (mkt === "double_chance") {
    const labels: Record<string, string> = {
      "1X": "home team or draw",
      "12": "either team wins (no draw)",
      "X2": "draw or away win",
    };
    return (
      `Double chance — ${labels[pred] ?? pred} covers two outcomes at ${conf}% confidence ` +
      `based on form analysis.`
    );
  }

  return `AI analysis complete. Best pick: ${mkt} — ${pred} at ${conf}% confidence.`;
}

// ── Full markdown analysis ────────────────────────────────────────────────────

export function buildAnalysis(
  features: MatchFeatures,
  confidence: ConfidenceData,
): string {
  const lines: string[] = [];

  lines.push(`## ${features.homeTeam} vs ${features.awayTeam}`);
  lines.push(`*${features.leagueName} · Data quality: **${features.dataQuality}** (${features.totalDataPoints} data points)*`);
  lines.push("");

  if (features.dataQuality === "none") {
    lines.push(
      "**Insufficient historical data.** This match has fewer than 4 data points " +
      "in the database. All confidence values reflect general football priors only."
    );
    return lines.join("\n");
  }

  // ── Home team form ──────────────────────────────────────────────────────────
  lines.push("### Home Team Form");
  const hv = features.homeVenueForm;
  if (hv.matches.length > 0) {
    lines.push(`**${features.homeTeam} at home** (last ${hv.matches.length} home matches)`);
    lines.push(`- Record: ${hv.wins}W ${hv.draws}D ${hv.losses}L — win rate **${pct(hv.winRate)}**`);
    lines.push(`- Goals scored: ${hv.goalsScored} (avg ${hv.avgGoalsScored.toFixed(2)}/game)`);
    lines.push(`- Goals conceded: ${hv.goalsConceded} (avg ${hv.avgGoalsConceded.toFixed(2)}/game)`);
    lines.push(`- Goal difference: **${hv.goalDifference >= 0 ? "+" : ""}${hv.goalDifference}**`);
    lines.push(`- BTTS: ${hv.bttsMatches}/${hv.matches.length} games (${pct(hv.bttsRate)})`);
    lines.push(`- Clean sheets: ${hv.cleanSheets}`);
    if (hv.formString) lines.push(`- Recent form: **${hv.formString}**`);
  } else {
    lines.push(`*No home venue history for ${features.homeTeam}.*`);
  }
  lines.push("");

  // ── Away team form ──────────────────────────────────────────────────────────
  lines.push("### Away Team Form");
  const av = features.awayVenueForm;
  if (av.matches.length > 0) {
    lines.push(`**${features.awayTeam} away** (last ${av.matches.length} away matches)`);
    lines.push(`- Record: ${av.wins}W ${av.draws}D ${av.losses}L — win rate **${pct(av.winRate)}**`);
    lines.push(`- Goals scored: ${av.goalsScored} (avg ${av.avgGoalsScored.toFixed(2)}/game)`);
    lines.push(`- Goals conceded: ${av.goalsConceded} (avg ${av.avgGoalsConceded.toFixed(2)}/game)`);
    lines.push(`- Goal difference: **${av.goalDifference >= 0 ? "+" : ""}${av.goalDifference}**`);
    lines.push(`- BTTS: ${av.bttsMatches}/${av.matches.length} games (${pct(av.bttsRate)})`);
    lines.push(`- Clean sheets: ${av.cleanSheets}`);
    if (av.formString) lines.push(`- Recent form: **${av.formString}**`);
  } else {
    lines.push(`*No away venue history for ${features.awayTeam}.*`);
  }
  lines.push("");

  // ── Head to Head ────────────────────────────────────────────────────────────
  lines.push("### Head to Head");
  const h2h = features.h2h;
  if (h2h.totalMatches > 0) {
    lines.push(`Last **${h2h.totalMatches}** meetings between these sides:`);
    lines.push(`- ${features.homeTeam} wins: **${h2h.homeWins}** · Draws: **${h2h.draws}** · ${features.awayTeam} wins: **${h2h.awayWins}**`);
    lines.push(`- Average goals per meeting: **${h2h.avgGoals.toFixed(2)}**`);
    lines.push(`- BTTS rate in H2H: **${pct(h2h.bttsRate)}**`);
    if (h2h.homeWins > h2h.awayWins) {
      lines.push(`- ${features.homeTeam} lead the head-to-head record.`);
    } else if (h2h.awayWins > h2h.homeWins) {
      lines.push(`- ${features.awayTeam} lead the head-to-head record.`);
    } else {
      lines.push(`- Head-to-head is level.`);
    }
  } else {
    lines.push("*No head-to-head history available between these sides.*");
  }
  lines.push("");

  // ── Confidence breakdown ────────────────────────────────────────────────────
  lines.push("### Confidence by Market");
  const m = confidence.markets;
  lines.push("| Market | Prediction | Confidence |");
  lines.push("|--------|------------|------------|");
  lines.push(`| 1X2 | Home win | **${m["1X2"].home.confidence}%** |`);
  lines.push(`| 1X2 | Draw | **${m["1X2"].draw.confidence}%** |`);
  lines.push(`| 1X2 | Away win | **${m["1X2"].away.confidence}%** |`);
  lines.push(`| BTTS | Yes | **${m["btts"].yes.confidence}%** |`);
  lines.push(`| BTTS | No | **${m["btts"].no.confidence}%** |`);
  lines.push(`| Over/Under | Over 2.5 | **${m["over_under"].over.confidence}%** |`);
  lines.push(`| Over/Under | Under 2.5 | **${m["over_under"].under.confidence}%** |`);
  lines.push(`| Double Chance | 1X (Home/Draw) | **${m["double_chance"]["1X"].confidence}%** |`);
  lines.push(`| Double Chance | 12 (Home/Away) | **${m["double_chance"]["12"].confidence}%** |`);
  lines.push(`| Double Chance | X2 (Draw/Away) | **${m["double_chance"]["X2"].confidence}%** |`);
  lines.push("");

  // ── Suggested pick ──────────────────────────────────────────────────────────
  lines.push("### AI Suggested Pick");
  lines.push(
    `**Market:** ${confidence.suggestedMarket} · ` +
    `**Prediction:** ${confidence.suggestedPrediction} · ` +
    `**Confidence:** ${confidence.suggestedConfidence}%`
  );
  lines.push(
    `**Risk level:** ${confidence.suggestedRiskLevel} · ` +
    `**VIP pick:** ${confidence.suggestedIsVip ? "Yes" : "No"}`
  );

  return lines.join("\n");
}
