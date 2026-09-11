import fs from "node:fs";
const path="src/modules/games/matchmaking/coinflip-matchmaking.service.ts";
let s=fs.readFileSync(path,"utf8");
// A finished match is never a recoverable active game. Recovery only resumes an active match.
s=s.replace('where: { userId, gameType, status: "matched", matchId: { not: null } }','where: { userId, gameType, stake, status: "matched", matchId: { not: null } }');
s=s.replace('where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }','where: { gameType, stake, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }');
s=s.replace('where: { userId, gameType, matchId: activeMatch.id }','where: { userId, gameType, stake, matchId: activeMatch.id }');
s=s.replace('where: { userId, gameType, status: "reserved", expiresAt: { gt: now } }','where: { userId, gameType, stake, status: "reserved", expiresAt: { gt: now } }');
s=s.replace('  void requestedStake;\n','');
s=s.replace('where: { userId, gameType: "pvp_coinflip", status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } }','where: { userId, gameType: "pvp_coinflip", stake: requestedStake, status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } }');
s=s.replace('if (!match || (match.status !== "active" && match.status !== "settled")) return { status: "cancelled" as const };','if (!match || match.status !== "active") return { status: "cancelled" as const };');
fs.writeFileSync(path,s);
console.log("Coin Flip recovery restricted to active requested-stake matches");
