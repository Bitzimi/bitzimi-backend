import fs from "node:fs";
const path = "src/modules/games/matchmaking/matchmaking.service.ts";
let s = fs.readFileSync(path, "utf8");
const DURATION = 12000;

// Coin Flip is stake-room isolated: every active/reserved/matched lookup must include stake.
s = s.replace(
  'where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }',
  'where: { gameType, stake, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }',
  1
);
s = s.replace(
  'where: { userId, gameType, status: "matched", matchId: { not: null } }',
  'where: { userId, gameType, stake, status: "matched", matchId: { not: null } }'
);
s = s.replace(
  'where: { userId, gameType, status: "reserved", expiresAt: { gt: now } }',
  'where: { userId, gameType, stake, status: "reserved", expiresAt: { gt: now } }'
);
s = s.replace(
  'where: { userId, gameType: "pvp_coinflip", status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } }',
  'where: { userId, gameType: "pvp_coinflip", stake: requestedStake, status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } }'
);
s = s.replace('  void requestedStake;\n', '');

// Backend-owned Coin Flip match creation: random Home/Away and independently random Heads/Tails.
const reservedPattern = /export async function createReservedMatchForPlayers\(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number\) \{[\s\S]*?\n\}\n\nasync function resolveDiceClash/;
const reservedReplacement = `export async function createReservedMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {
  const totalPool = stake * 2;
  const feeRate = await getGameFeeRate(gameType);
  const fee = totalPool * feeRate;
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const verificationId = gameType === "reaction_tap" ? undefined : generateVerificationId(gameType);

  if (gameType !== "pvp_coinflip") {
    const match = await db.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } });
    try { if (gameType === "dice_clash") await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); }
    catch (err) { console.error(\`[Matchmaking] Immediate settlement deferred for \${match.id}:\`, err); }
    return db.pvpMatch.findUniqueOrThrow({ where: { id: match.id } });
  }

  const homeIsPlayer1 = randomInt(0, 2) === 0;
  const homePlayerId = homeIsPlayer1 ? player1Id : player2Id;
  const awayPlayerId = homeIsPlayer1 ? player2Id : player1Id;
  const p1IsHeads = randomInt(0, 2) === 0;
  const p1Side = p1IsHeads ? "heads" : "tails";
  const p2Side = p1IsHeads ? "tails" : "heads";
  const clientSeed = generateClientSeed(player1Id, player2Id, String(Date.now()), String(randomInt(0, 1_000_000)));
  const coinFlip = deriveCoinFlip(serverSeed, clientSeed, 1);
  const winnerId = coinFlip === p1Side ? player1Id : player2Id;
  const resultData = JSON.stringify({ homePlayerId, awayPlayerId, p1Side, p2Side, coinFlip, winnerId });

  return db.pvpMatch.create({
    data: {
      gameType, stake, player1Id, player2Id, serverSeedHash, serverSeed,
      clientSeed, verificationId, resultData
    }
  });
}

async function resolveDiceClash`;
if (!reservedPattern.test(s)) throw new Error("Coin Flip reserved-match creation block not found");
s = s.replace(reservedPattern, reservedReplacement);

// Coin Flip must never be settled at creation. Its result is sealed in resultData and the
// cleanup/recovery worker settles exactly once after the authoritative timeline.
const coinResolvePattern = /async function resolveCoinFlip\(matchId:string,p1Id:string,p2Id:string,stake:number,fee:number,totalPool:number,serverSeed:string,feeRate:number\)\{[\s\S]*?\n\}\nexport async function getMatch/;
const coinResolveReplacement = `async function resolveCoinFlip(matchId:string,p1Id:string,p2Id:string,stake:number,fee:number,totalPool:number,serverSeed:string,feeRate:number){
  const match = await db.pvpMatch.findUnique({ where: { id: matchId }, select: { resultData: true, clientSeed: true, serverSeedHash: true } });
  if (!match) return;
  let stored:any = null;
  try { stored = match.resultData ? JSON.parse(match.resultData) : null; } catch { stored = null; }
  if (!stored?.p1Side || !stored?.p2Side || !stored?.coinFlip || !stored?.winnerId) return;
  const verifiedCoinFlip = deriveCoinFlip(serverSeed, match.clientSeed ?? "", 1);
  if (verifiedCoinFlip !== stored.coinFlip || hashServerSeed(serverSeed) !== match.serverSeedHash) throw new Error("Coin Flip fairness data mismatch");
  const winnerId = stored.winnerId === p1Id || stored.winnerId === p2Id ? stored.winnerId : null;
  if (!winnerId) throw new Error("Invalid Coin Flip winner");
  const loserId=winnerId===p1Id?p2Id:p1Id;
  const payout=totalPool-fee;
  await db.$transaction(async tx=>{const guard=await tx.pvpMatch.updateMany({where:{id:matchId,status:"active"},data:{status:"settled",winnerId,resultData:JSON.stringify({homePlayerId:stored.homePlayerId,awayPlayerId:stored.awayPlayerId,p1Side:stored.p1Side,p2Side:stored.p2Side,coinFlip:stored.coinFlip,winnerId}),settledAt:new Date(),serverSeed,clientSeed:match.clientSeed,nonce:1}});if(!guard.count)return;await creditWallet(tx,winnerId,"game",payout);await writeLedgerEntry(tx,{userId:winnerId,type:"game_win",toWallet:"game",amount:payout,description:"Coin Flip win",referenceId:matchId,referenceType:"pvp_match"});await writeLedgerEntry(tx,{userId:loserId,type:"game_loss",fromWallet:"game",amount:stake,description:"Coin Flip loss",referenceId:matchId,referenceType:"pvp_match"});await recordGameResult({tx,userId:winnerId,gameType:"pvp_coinflip",wagered:stake,won:true,payout});await recordGameResult({tx,userId:loserId,gameType:"pvp_coinflip",wagered:stake,won:false,payout:0});await createGameNotification(tx,winnerId,true,"Coin Flip",stake,payout,loserId);await createGameNotification(tx,loserId,false,"Coin Flip",stake,0,winnerId);const userFee=stake*feeRate;await createGameFeeJobInTx(tx,{userId:winnerId,userFee,isMultiGame:false,eventRefId:matchId});await createGameFeeJobInTx(tx,{userId:loserId,userFee,isMultiGame:false,eventRefId:matchId})})}
export async function getMatch`;
if (!coinResolvePattern.test(s)) throw new Error("Coin Flip resolver block not found");
s = s.replace(coinResolvePattern, coinResolveReplacement);

// Recovery worker: wait for the authoritative timeline, then settle persisted Coin Flip state.
const recoverPattern = /async function recoverUnresolvedImmediateMatches\(\)\{[\s\S]*?\n\}/;
const recoverReplacement = `async function recoverUnresolvedImmediateMatches(){const now=Date.now();const matches=await db.pvpMatch.findMany({where:{status:"active",gameType:{in:["dice_clash","pvp_coinflip"]}},take:100});for(const m of matches){const feeRate=await getGameFeeRate(m.gameType as MatchGameType);const totalPool=m.stake*2;const fee=totalPool*feeRate;if(m.gameType==="pvp_coinflip"){if(now-m.createdAt.getTime()<${DURATION})continue;if(!m.serverSeed||!m.clientSeed)continue;try{await resolveCoinFlip(m.id,m.player1Id,m.player2Id,m.stake,fee,totalPool,m.serverSeed,feeRate)}catch(err){console.error(\`[CoinFlip] Settlement retry failed for \${m.id}:\`,err)}}else{if(!m.serverSeed)continue;try{await resolveDiceClash(m.id,m.player1Id,m.player2Id,m.stake,fee,totalPool,m.serverSeed,feeRate)}catch{}}}}`;
if (!recoverPattern.test(s)) throw new Error("Recovery worker block not found");
s = s.replace(recoverPattern, recoverReplacement);

// Match response exposes backend-selected Home/Away and backend-selected sides.
const oldReturn = 'return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,status:match.status,isPlayer1,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:match.resultData?JSON.parse(match.resultData):null,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready}}';
const newReturn = 'const parsedResult=match.resultData?JSON.parse(match.resultData):null;const isHome=parsedResult?.homePlayerId===userId;const playerSide=isPlayer1?parsedResult?.p1Side:parsedResult?.p2Side;const opponentSide=isPlayer1?parsedResult?.p2Side:parsedResult?.p1Side;return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,status:match.status,isPlayer1,isHome,playerSide,opponentSide,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:parsedResult,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready}}';
if (!s.includes(oldReturn)) throw new Error("Coin Flip getMatch return block not found");
s = s.replace(oldReturn,newReturn);

fs.writeFileSync(path,s);
console.log("Coin Flip backend repair applied");
