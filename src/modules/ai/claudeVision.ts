/**
 * Claude Vision — server-side task proof verification.
 *
 * Previously called from the frontend (VITE_ANTHROPIC_API_KEY exposed in the
 * public JS bundle). This module is the backend replacement.
 *
 * Uses ANTHROPIC_API_KEY environment variable (server-side only — never
 * prefix with VITE_).
 *
 * Model: claude-opus-4-5  (matches frontend VerificationConfig)
 * Thresholds: ≥85 approved | 70–84 review | <70 rejected
 * Fallback:   API error → verdict "review", confidence 72 (never auto-approve)
 *
 * TODO(phase-3h): Queue calls via BullMQ for back-pressure management
 * and automatic retries on Anthropic rate-limit (429) responses.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL   = "claude-opus-4-5";

const AUTO_APPROVE_THRESHOLD  = 85;
const MANUAL_REVIEW_THRESHOLD = 70;

export interface AIVerdict {
  confidence: number;
  verdict:    "approved" | "review" | "rejected";
  analysis:   string;
}

// ── Platform-specific verification guidance (matches frontend exactly) ────────

function platformGuide(categorySlug: string): string {
  const guides: Record<string, string> = {
    telegram_join: `TELEGRAM CHANNEL/GROUP: STRONG APPROVE if → channel/group name matches AND join button absent AND membership evidence visible (message input, bell, muted option). REJECT: join button still shown; wrong channel.`,
    social_media_follow: `SOCIAL FOLLOW: STRONG APPROVE → target handle visible AND "Following"/"Subscribed" state shown. REJECT: active Follow/Subscribe button still shown; wrong profile.`,
    youtube_subscribe: `YOUTUBE: STRONG APPROVE → channel name matches AND "Subscribed"/"Joined" state AND bell icon visible. REJECT: red Subscribe button still shown.`,
    website_visit: `WEBSITE VISIT: STRONG APPROVE → correct URL in browser address bar AND page content matches reference. REJECT: wrong website.`,
    app_download_registration: `APP: STRONG APPROVE → app open/running AND welcome screen or user dashboard visible. REJECT: no evidence of install or account creation.`,
  };
  return guides[categorySlug] ?? `GENERAL TASK: Compare proof against references contextually. Focus on action-completion evidence. Strong signals: correct name/handle, action-complete UI state. Reject only with clear evidence of failure or fraud.`;
}

// ── Main verification function ────────────────────────────────────────────────

export async function verifyTaskProof(opts: {
  proofScreenshots:     string[];   // base64 data URLs (up to 3)
  referenceScreenshots: string[];   // advertiser reference images (up to 3)
  taskInstructions:     string;
  categorySlug:         string;
}): Promise<AIVerdict> {
  if (!ANTHROPIC_API_KEY) {
    console.warn("[ClaudeVision] ANTHROPIC_API_KEY not set — defaulting to manual review");
    return { confidence: 72, verdict: "review", analysis: "API key not configured — manual review required." };
  }

  const { proofScreenshots, referenceScreenshots, taskInstructions, categorySlug } = opts;

  // Build image content blocks
  type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
  const blocks: Block[] = [];

  // Reference screenshots first
  if (referenceScreenshots.length > 0) {
    blocks.push({ type: "text", text: "ADVERTISER REFERENCE SCREENSHOTS (what success looks like):" });
    for (const ref of referenceScreenshots.slice(0, 3)) {
      const m = ref.match(/^data:([^;]+);base64,(.+)$/);
      if (m) blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
  }

  // Proof screenshots
  blocks.push({ type: "text", text: "USER PROOF SCREENSHOTS (what the user submitted):" });
  for (const proof of proofScreenshots.slice(0, 3)) {
    const m = proof.match(/^data:([^;]+);base64,(.+)$/);
    if (m) blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }

  const systemPrompt = `You are a precise task proof verification AI for the Bitzimi platform.
Analyze screenshots to determine if the user genuinely completed the task.

${platformGuide(categorySlug)}

SCORING GUIDE:
90-100: Irrefutable proof of task completion
80-89: Strong evidence, minor ambiguity
70-79: Reasonable evidence but some doubt
50-69: Insufficient or unclear proof
0-49: No valid proof or fraudulent submission

Respond ONLY with valid JSON (no markdown, no explanations outside JSON):
{
  "confidence": <integer 0-100>,
  "verdict": "<approved|review|rejected>",
  "analysis": "<1-2 sentence explanation>"
}

Apply thresholds: ≥85 → approved, 70-84 → review, <70 → rejected.`;

  const userMessage = `Task instructions: ${taskInstructions}\nCategory: ${categorySlug}\n\nAnalyze the proof screenshots above against the reference screenshots and task requirements.`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: blocks.concat({ type: "text", text: userMessage }) }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[ClaudeVision] API error ${response.status}:`, err);
      return { confidence: 72, verdict: "review", analysis: `API error (${response.status}) — manual review required.` };
    }

    const data: any = await response.json();
    const raw = data.content?.[0]?.text ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));

    // Re-apply thresholds (Claude may not perfectly follow the guide)
    let verdict: "approved" | "review" | "rejected";
    if (confidence >= AUTO_APPROVE_THRESHOLD) verdict = "approved";
    else if (confidence >= MANUAL_REVIEW_THRESHOLD) verdict = "review";
    else verdict = "rejected";

    return { confidence, verdict, analysis: String(parsed.analysis || "").slice(0, 1000) };

  } catch (err) {
    console.error("[ClaudeVision] Verification failed:", err);
    return { confidence: 72, verdict: "review", analysis: "Verification error — manual review required." };
  }
}
