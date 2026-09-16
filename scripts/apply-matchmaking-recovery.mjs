import fs from "node:fs";

const QUEUE_LEASE_MS = "20 * 1000";
const files = [
  "src/modules/games/matchmaking/matchmaking.service.ts",
  "src/modules/games/matchmaking/coinFlipMatchmaking.service.ts",
];

for (const path of files) {
  let s = fs.readFileSync(path, "utf8");

  s = s.replaceAll(
    "const QUEUE_TTL_MS = 5 * 60 * 1000;",
    `const QUEUE_TTL_MS = ${QUEUE_LEASE_MS}; // active-search lease; heartbeat extends it`
  );
  s = s.replaceAll(
    "const QUEUE_TTL_MS    = 5 * 60 * 1000;  // 5 minutes",
    `const QUEUE_TTL_MS    = ${QUEUE_LEASE_MS}; // active-search lease; heartbeat extends it`
  );

  // Never resurrect an expired waiting queue when the same user starts Search again.
  s = s.replaceAll(
    'where: { userId, gameType, stake, status: "waiting" },',
    'where: { userId, gameType, stake, status: "waiting", expiresAt: { gt: new Date() } },'
  );

  // Fail closed if the file has drifted and the lease was not applied.
  if (s.includes("const QUEUE_TTL_MS = 5 * 60 * 1000;") || s.includes("const QUEUE_TTL_MS    = 5 * 60 * 1000;")) {
    throw new Error(`Matchmaking lease patch did not apply cleanly to ${path}`);
  }

  fs.writeFileSync(path, s);
}
