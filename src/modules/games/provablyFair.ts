import { createHmac, createHash, randomBytes } from "crypto";

const VID_PREFIXES: Record<string, string> = {
  color_game:   "BZM-CP",
  spin_battle:  "BZM-SB",
  pvp_coinflip: "BZM-CF",
  dice_clash:   "BZM-DC",
  dice_royale:  "BZM-DR",
  dice_arena:   "BZM-DA",
};

export function generateVerificationId(gameType: string): string {
  const prefix = VID_PREFIXES[gameType];
  if (!prefix) throw new Error(`No verification ID prefix for game type: ${gameType}`);
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${suffix}`;
}

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

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashServerSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

export function generateClientSeed(...publicParts: string[]): string {
  return createHash("sha256").update(publicParts.join("|")).digest("hex");
}

function getResultBytes(serverSeed: string, clientSeed: string, nonce: number): Buffer {
  const hmac = createHmac("sha256", serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  return Buffer.from(hmac.digest("hex"), "hex");
}

function uint32At(buf: Buffer, index: number): number {
  return buf.readUInt32BE((index * 4) % 28);
}

export function deriveColorResult(serverSeed: string, clientSeed: string, nonce: number): "red" | "blue" {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  return b[0] % 2 === 0 ? "red" : "blue";
}

export function deriveCoinFlip(serverSeed: string, clientSeed: string, nonce: number): "heads" | "tails" {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  return b[0] % 2 === 0 ? "heads" : "tails";
}

export function deriveDiceClash(serverSeed: string, clientSeed: string, nonce: number): { p1Roll: number; p2Roll: number } {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  let p1Roll = (uint32At(b, 0) % 6) + 1;
  let p2Roll = (uint32At(b, 1) % 6) + 1;
  for (let i = 2; p1Roll === p2Roll && i < 7; i += 2) {
    p1Roll = (uint32At(b, i) % 6) + 1;
    p2Roll = (uint32At(b, i + 1) % 6) + 1;
  }
  return { p1Roll, p2Roll };
}

export function deriveDiceRolls(serverSeed: string, clientSeed: string, nonce: number, sortedPlayerIds: string[]): Record<string, number> {
  const b = getResultBytes(serverSeed, clientSeed, nonce);
  const rolls: Record<string, number> = {};
  for (let i = 0; i < sortedPlayerIds.length; i++) {
    rolls[sortedPlayerIds[i]] = (uint32At(b, i) % 6) + 1;
  }
  return rolls;
}

export function deriveTieBreakRolls(serverSeed: string, clientSeed: string, nonce: number, tbRound: number, candidateIds: string[]): Record<string, number> {
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
 * Spin Battle winner is selected proportionally to each player's locked stake.
 * Rejection sampling over a 64-bit HMAC value avoids modulo bias.
 */
export function deriveSpinWinner(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  sortedPlayerIds: string[],
  playerWeights: Record<string, number> = {},
): string {
  if (sortedPlayerIds.length === 0) throw new Error("Spin Battle requires at least one player");
  const scale = 1_000_000;
  const weights = sortedPlayerIds.map(id => Math.max(0, Math.round((playerWeights[id] ?? 0) * scale)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("Spin Battle requires positive player stakes");

  const TWO64 = 18446744073709551616n;
  for (let attempt = 0; attempt < 16; attempt++) {
    const b = getResultBytes(serverSeed, clientSeed, nonce + attempt);
    const x = (BigInt(uint32At(b, 0)) << 32n) | BigInt(uint32At(b, 1));
    const totalBig = BigInt(total);
    const limit = (TWO64 / totalBig) * totalBig;
    if (x >= limit) continue;
    let cursor = Number(x % totalBig);
    for (let i = 0; i < weights.length; i++) {
      if (cursor < weights[i]) return sortedPlayerIds[i];
      cursor -= weights[i];
    }
  }
  return sortedPlayerIds[weights.findIndex(w => w > 0)];
}

export interface VerifyInput {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  gameType: string;
  claimedResult?: any;
}

export interface VerifyOutput {
  hashValid: boolean;
  resultValid: boolean | null;
  computedResult: any;
  algorithm: string;
  explanation: string;
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
        resultValid = input.claimedResult ? computedResult === input.claimedResult : null;
        explanation = `Color determined by byte[0] of HMAC output: even→red, odd→blue`;
        break;
      }
      case "pvp_coinflip": {
        const flip = deriveCoinFlip(input.serverSeed, input.clientSeed, input.nonce);
        computedResult = { coinFlip: flip };
        resultValid = input.claimedResult ? flip === input.claimedResult.coinFlip : null;
        explanation = `Coin determined by byte[0] of HMAC output: even→heads, odd→tails`;
        break;
      }
      case "dice_clash": {
        computedResult = deriveDiceClash(input.serverSeed, input.clientSeed, input.nonce);
        resultValid = input.claimedResult
          ? computedResult.p1Roll === input.claimedResult.p1Roll && computedResult.p2Roll === input.claimedResult.p2Roll
          : null;
        explanation = `Player 1 and Player 2 rolls are derived from independent HMAC words; equal rolls receive deterministic tie-break derivation.`;
        break;
      }
      case "spin_battle": {
        const weights = input.claimedResult?.playerBets as Record<string, number> | undefined;
        const playerIds = input.claimedResult?.playerIds as string[] | undefined;
        if (!weights || !playerIds?.length) {
          explanation = `Stake-proportional winner requires the settled player list and each locked stake.`;
          computedResult = null;
          resultValid = null;
          break;
        }
        const ordered = [...playerIds].sort();
        const weightObject = Object.fromEntries(ordered.map(id => [id, Number(weights[id] ?? 0)]));
        const winner = deriveSpinWinner(input.serverSeed, input.clientSeed, input.nonce, ordered, weightObject);
        computedResult = { winner };
        resultValid = input.claimedResult?.winner ? winner === input.claimedResult.winner : null;
        explanation = `Winner is selected from locked player stakes using unbiased 64-bit HMAC sampling; probability equals stake / total stake.`;
        break;
      }
      case "dice_royale":
      case "dice_arena": {
        explanation = `Player i roll = HMAC-derived uint32 % 6 + 1 in stable sorted player order. Ties use deterministic sub-nonces.`;
        computedResult = null;
        resultValid = null;
        break;
      }
      default:
        explanation = `Unknown game type: ${input.gameType}`;
    }
  } catch {
    explanation = "Verification error — check inputs";
  }

  return { hashValid, resultValid, computedResult, algorithm, explanation };
}
