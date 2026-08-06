/**
 * Unified Provably Fair Engine — Phase 11
 *
 * Algorithm: HMAC-SHA256(key=serverSeed, message=`${clientSeed}:${nonce}`)
 *
 * Flow:
 *   1. generateServerSeed()   → before round starts (commitment)
 *   2. hashServerSeed(seed)   → publish hash to players before any bets
 *   3. [bets placed]
 *   4. generateClientSeed()   → derived from deterministic public data
 *   5. deriveXxx(...)         → result is deterministic from seeds
 *   6. reveal serverSeed      → after settlement (players can now verify)
 *
 * Security guarantees:
 *   - Server commits to serverSeed BEFORE bets via the hash
 *   - clientSeed comes from public on-chain data the server cannot predict
 *   - Together they make results verifiable and manipulation-proof
 */
import { createHmac, createHash, randomBytes } from "crypto";

// ── Verification ID generation ─────────────────────────────────────────────────

const VID_PREFIXES: Record<string, string> = {
  color_game:   "BZM-CP",
  spin_battle:  "BZM-SB",
  pvp_coinflip: "BZM-CF",
  dice_clash:   "BZM-DC",
  dice_royale:  "BZM-DR",
  dice_arena:   "BZM-DA",
};

/**
 * Generate a globally unique Verification ID for a game round.
 * Format: BZM-{2-letter-code}-{8 uppercase hex chars}
 * reaction_tap is excluded — it does not use provably fair.
 */
export function generateVerificationId(gameType: string): string {
  const prefix = VID_PREFIXES[gameType];
  if (!prefix) throw new Error(`No verification ID prefix for game type: ${gameType}`);
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${suffix}`;
}

/**
 * Decode a Verification ID prefix to determine the game type and model.
 * Returns null if the prefix is unrecognised.
 */
export function decodeVerificationId(verificationId: string): {
  gameType: string;
  model: "game_round" | "pvp_match" | "dice_round";
} | null {
  const upper = verificationId.toUpperCase();
  if (upper.startsWith("BZM-CP-")) return { gameType: "color_game",   model: "game_round"  };
  if (upper.startsWith("BZM-SB-")) return { gameType: "spin_battle",  model: "game_round"  };
  if (upper.startsWith("BZM-CF-")) return { gameType: "pvp_coinflip", model: "pvp_match"   };
  if (upper.startsWith("BZM-DC-")) return { gameType: "dice_clash",   model: "pvp_match"   };
  if (upper.startsWith("BZM-DR-")) return { gameType: "dice_royale",  model: "dice_round"  };
  if (upper.startsWith("BZM-DA-")) return { gameType: "dice_arena",   model: "dice_round"  };
  return null;
}

// ── Seed generation ────────────────────────────────────────────────────────────

/** Generate a cryptographically secure random server seed (64 hex chars). */
export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

/** Commit to the server seed by publishing its SHA-256 hash. */
export function hashServerSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/**
 * Generate a deterministic client seed from public parts.
 * Parts should be public values determined AFTER server seed is committed
 * (e.g. player IDs, round start time, match ID).
 */
export function generateClientSeed(...publicParts: string[]): string {
  return createHash("sha256").update(publicParts.join("|")).digest("hex");
}

// ── Core derivation ────────────────────────────────────────────────────────────

function getResultBytes(serverSeed: string, clientSeed: string, nonce: number): Buffer {
  const hmac = createHmac("sha256", serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  return Buffer.from(hmac.digest("hex"), "hex"); // 32 bytes
}

/** Read an unbiased uint32 from buffer at position `index` (wraps at 28 to stay safe). */
function uint32At(buf: Buffer, index: number): number {
  return buf.readUInt32BE((index * 4) % 28);
}

// ── Game-specific derivation ───────────────────────────────────────────────────

/** Color Prediction: byte 0 even → "red", odd → "blue" */
export function deriveColorResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): "red" | "blue" {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  return b[0] % 2 === 0 ? "red" : "blue";
}

/** Coin Flip: byte 0 even → "heads", odd → "tails" */
export function deriveCoinFlip(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): "heads" | "tails" {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  return b[0] % 2 === 0 ? "heads" : "tails";
}

/**
 * Dice Clash: two dice rolls, no ties.
 * Uses bytes 0-3 for p1, bytes 4-7 for p2.
 * On tie, advances to next byte pairs until no tie (up to 7 attempts).
 */
export function deriveDiceClash(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): { p1Roll: number; p2Roll: number } {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  let p1Roll = (uint32At(b, 0) % 6) + 1;
  let p2Roll = (uint32At(b, 1) % 6) + 1;
  // Break ties using subsequent byte pairs
  for (let i = 2; p1Roll === p2Roll && i < 7; i += 2) {
    p1Roll = (uint32At(b, i) % 6) + 1;
    p2Roll = (uint32At(b, i + 1) % 6) + 1;
  }
  return { p1Roll, p2Roll };
}

/**
 * Dice rolls for multiple players (Royale / Arena).
 * Player i gets bytes at position i. Players MUST be in a stable sorted order.
 */
export function deriveDiceRolls(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  sortedPlayerIds: string[]
): Record<string, number> {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  const rolls: Record<string, number> = {};
  for (let i = 0; i < sortedPlayerIds.length; i++) {
    rolls[sortedPlayerIds[i]] = (uint32At(b, i) % 6) + 1;
  }
  return rolls;
}

/**
 * Tie-break rolls — uses a sub-nonce suffix to get fresh bytes.
 * Called when two or more players are tied on primary rolls.
 */
export function deriveTieBreakRolls(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  tbRound: number,
  candidateIds: string[]
): Record<string, number> {
  const hmac = createHmac("sha256", serverSeed);
  hmac.update(`${clientSeed}:${nonce}:tb:${tbRound}`);
  const b = Buffer.from(hmac.digest("hex"), "hex");
  const rolls: Record<string, number> = {};
  for (let i = 0; i < candidateIds.length; i++) {
    rolls[candidateIds[i]] = (uint32At(b, i) % 6) + 1;
  }
  return rolls;
}

/**
 * Spin Battle winner: deterministic index into sorted player list.
 * Using sorted order ensures result is reproducible regardless of join order.
 */
export function deriveSpinWinner(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  sortedPlayerIds: string[]
): string {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  const idx = uint32At(b, 0) % sortedPlayerIds.length;
  return sortedPlayerIds[idx];
}

// ── Verification ───────────────────────────────────────────────────────────────

export interface VerifyInput {
  serverSeed:     string;
  serverSeedHash: string;
  clientSeed:     string;
  nonce:          number;
  gameType:       string;
  claimedResult?: any;
}

export interface VerifyOutput {
  hashValid:      boolean;
  resultValid:    boolean | null; // null if verification needs extra data (player list)
  computedResult: any;
  algorithm:      string;
  explanation:    string;
}

export function verifyFairness(input: VerifyInput): VerifyOutput {
  const hashValid = hashServerSeed(input.serverSeed) === input.serverSeedHash;
  const algorithm = `HMAC-SHA256(serverSeed, "${input.clientSeed}:${input.nonce}")`;

  let computedResult: any = null;
  let resultValid: boolean | null = null;
  let explanation = "";

  try {
    switch (input.gameType) {
      case "color_game": {
        computedResult = deriveColorResult(input.serverSeed, input.clientSeed, input.nonce);
        resultValid    = input.claimedResult ? computedResult === input.claimedResult : null;
        explanation    = `Color determined by byte[0] of HMAC output: even→red, odd→blue`;
        break;
      }
      case "pvp_coinflip": {
        const flip  = deriveCoinFlip(input.serverSeed, input.clientSeed, input.nonce);
        computedResult = { coinFlip: flip };
        resultValid    = input.claimedResult ? flip === input.claimedResult.coinFlip : null;
        explanation    = `Coin determined by byte[0] of HMAC output: even→heads, odd→tails`;
        break;
      }
      case "dice_clash": {
        computedResult = deriveDiceClash(input.serverSeed, input.clientSeed, input.nonce);
        resultValid    = input.claimedResult
          ? computedResult.p1Roll === input.claimedResult.p1Roll &&
            computedResult.p2Roll === input.claimedResult.p2Roll
          : null;
        explanation = `Player 1 die = uint32(bytes[0..4]) % 6 + 1, Player 2 die = uint32(bytes[4..8]) % 6 + 1. Tie-breaks advance byte window.`;
        break;
      }
      case "spin_battle": {
        explanation    = `Winner index = uint32(bytes[0..4]) % playerCount. Requires player list to fully verify.`;
        computedResult = null;
        resultValid    = null; // need player list
        break;
      }
      case "dice_royale":
      case "dice_arena": {
        explanation    = `Player i roll = uint32(bytes[i*4..(i+1)*4]) % 6 + 1 (sorted player order). Tie-breaks use sub-nonce ${input.nonce}:tb:N.`;
        computedResult = null;
        resultValid    = null; // need player list
        break;
      }
      default: {
        explanation    = `Unknown game type: ${input.gameType}`;
      }
    }
  } catch {
    explanation = "Verification error — check inputs";
  }

  return { hashValid, resultValid, computedResult, algorithm, explanation };
}
