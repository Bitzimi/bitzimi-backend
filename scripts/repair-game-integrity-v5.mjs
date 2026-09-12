import fs from "node:fs";

const path = "src/modules/games/matchmaking/matchmaking.service.ts";
let s = fs.readFileSync(path, "utf8");

const between = (source, startMarker, endMarker, replacement) => {
  const a = source.indexOf(startMarker);
  const b = source.indexOf(endMarker, a + startMarker.length);
  if (a < 0 || b < 0) throw new Error(`Cannot replace block: ${startMarker}`);
  return source.slice(0, a) + replacement + source.slice(b);
};

if (!s.includes("const COIN_FLIP_DURATION_MS = 8_000;")) {
  s = s.replace('const REACTION_TAP_TIMEOUT_MS = 20_000;', 'const REACTION_TAP_TIMEOUT_MS = 20_000;\nconst COIN_FLIP_DURATION_MS = 8_000;');
}

s = s.replace('await recoverUnresolvedImmediateMatches(); await processReactionTapTimeouts();', 'await recoverUnresolvedImmediateMatches(); await processCoinFlipSettlements(); await processReactionTapTimeouts();');

const createMatch = `export async function createMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {
  const totalPool = stake * 2; const feeRate = await getGameFeeRate(gameType); const fee = totalPool * feeRate;
  const serverSeed = generateServerSeed(); const serverSeedHash = hashServerSeed(serverSeed);
  const verificationId = gameType === "reaction_tap" ? undefined : generateVerificationId(gameType);
  if (gameType === "pvp_coinflip" && randomInt(2) === 1) [player1Id, player2Id] = [player2Id, player1Id];
  const match = await db.$transaction(async tx => {
    for (const pid of [player1Id, player2Id]) await debitWallet(tx, pid, "game", stake);
    return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId, ...(gameType === "pvp_coinflip" ? { serverSeed } : {}) } });
  });
  try {
    if (gameType === "dice_clash") await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate);
    else if (gameType === "pvp_coinflip") await prepareCoinFlipMatch(match.id, player1Id, player2Id, serverSeed);
  } catch (err) { console.error('[Matchmaking] Match preparation deferred for ' + match.id + ':', err); }
  return db.pvpMatch.findUniqueOrThrow({ where: { id: match.id } });
}

export async function createReservedMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {
  const totalPool = stake * 2; const feeRate = await getGameFeeRate(gameType); const fee = totalPool * feeRate;
  const serverSeed = generateServerSeed(); const serverSeedHash = hashServerSeed(serverSeed);
  const verificationId = gameType === "reaction_tap" ? undefined : generateVerificationId(gameType);
  if (gameType === "pvp_coinflip" && randomInt(2) === 1) [player1Id, player2Id] = [player2Id, player1Id];
  const match = await db.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId, ...(gameType === "pvp_coinflip" ? { serverSeed } : {}) } });
  try {
    if (gameType === "dice_clash") await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate);
    else if (gameType === "pvp_coinflip") await prepareCoinFlipMatch(match.id, player1Id, player2Id, serverSeed);
  } catch (err) { console.error('[Matchmaking] Match preparation deferred for ' + match.id + ':', err); }
  return db.pvpMatch.findUniqueOrThrow({ where: { id: match.id } });
}

`;
s = between(s, "export async function createMatchForPlayers", "async function resolveDiceClash", createMatch);

const coinflipResolver = `async function prepareCoinFlipMatch(matchId:string,p1Id:string,p2Id:string,serverSeed:string){
  const clientSeed=generateClientSeed(...[p1Id,p2Id].sort(),matchId);
  const coinFlip=deriveCoinFlip(serverSeed,clientSeed,1);
  const p1Side: "heads" | "tails" = randomInt(2) === 0 ? "heads" : "tails";
  const p2Side: "heads" | "tails" = p1Side === "heads" ? "tails" : "heads";
  const winnerId=coinFlip===p1Side?p1Id:p2Id;
  await db.pvpMatch.updateMany({where:{id:matchId,status:"active"},data:{resultData:JSON.stringify({p1Side,p2Side,coinFlip,winnerId}),clientSeed,nonce:1}});
}

async function resolveCoinFlip(matchId:string,p1Id:string,p2Id:string,stake:number,fee:number,totalPool:number,serverSeed:string,feeRate:number){
  const existing=await db.pvpMatch.findUnique({where:{id:matchId},select:{resultData:true}});
  const result=existing?.resultData?JSON.parse(existing.resultData):null;
  const coinFlip=result?.coinFlip as "heads"|"tails"|undefined;
  const winnerId=result?.winnerId as string|undefined;
  if(!coinFlip||!winnerId){await prepareCoinFlipMatch(matchId,p1Id,p2Id,serverSeed);return;}
  const loserId=winnerId===p1Id?p2Id:p1Id;
  const payout=totalPool-fee;
  const clientSeed=result?.clientSeed??generateClientSeed(...[p1Id,p2Id].sort(),matchId);
  await db.$transaction(async tx=>{
    const guard=await tx.pvpMatch.updateMany({where:{id:matchId,status:"active"},data:{status:"settled",winnerId,resultData:JSON.stringify({p1Side:result.p1Side,p2Side:result.p2Side,coinFlip,winnerId}),settledAt:new Date(),serverSeed,clientSeed,nonce:result?.nonce??1}});
    if(!guard.count)return;
    await creditWallet(tx,winnerId,"game",payout);
    await writeLedgerEntry(tx,{userId:winnerId,type:"game_win",toWallet:"game",amount:payout,description:"Coin Flip win",referenceId:matchId,referenceType:"pvp_match"});
    await writeLedgerEntry(tx,{userId:loserId,type:"game_loss",fromWallet:"game",amount:stake,description:"Coin Flip loss",referenceId:matchId,referenceType:"pvp_match"});
    await recordGameResult({tx,userId:winnerId,gameType:"pvp_coinflip",wagered:stake,won:true,payout});
    await recordGameResult({tx,userId:loserId,gameType:"pvp_coinflip",wagered:stake,won:false,payout:0});
    await createGameNotification(tx,winnerId,true,"Coin Flip",stake,payout,loserId);
    await createGameNotification(tx,loserId,false,"Coin Flip",stake,0,winnerId);
    const userFee=stake*feeRate;
    await createGameFeeJobInTx(tx,{userId:winnerId,userFee,isMultiGame:false,eventRefId:matchId});
    await createGameFeeJobInTx(tx,{userId:loserId,userFee,isMultiGame:false,eventRefId:matchId});
  });
}

async function processCoinFlipSettlements(){
  const cutoff=new Date(Date.now()-COIN_FLIP_DURATION_MS);
  const matches=await db.pvpMatch.findMany({where:{gameType:"pvp_coinflip",status:"active",createdAt:{lte:cutoff}},take:100});
  for(const m of matches){
    if(!m.serverSeed)continue;
    const feeRate=await getGameFeeRate("pvp_coinflip");
    const totalPool=m.stake*2; const fee=totalPool*feeRate;
    try{await resolveCoinFlip(m.id,m.player1Id,m.player2Id,m.stake,fee,totalPool,m.serverSeed,feeRate)}catch(err){console.error('[CoinFlip] Settlement retry failed for ' + m.id + ':',err)}
  }
}

`;
s = between(s, "async function resolveCoinFlip", "export async function getMatch", coinflipResolver + "export async function getMatch");

const getMatch = `export async function getMatch(userId:string,matchId:string){
  let match=await db.pvpMatch.findFirst({where:{id:matchId,OR:[{player1Id:userId},{player2Id:userId}]},include:{player1:{include:{profile:{select:{username:true,avatarUrl:true}}}},player2:{include:{profile:{select:{username:true,avatarUrl:true}}}}}});
  if(!match)throw Object.assign(new Error("Match not found"),{statusCode:404,code:"NOT_FOUND"});
  if(match.gameType==="pvp_coinflip"&&match.status==="active"&&match.createdAt.getTime()<=Date.now()-COIN_FLIP_DURATION_MS&&match.serverSeed){
    const feeRate=await getGameFeeRate("pvp_coinflip");
    await resolveCoinFlip(match.id,match.player1Id,match.player2Id,match.stake,match.stake*2*feeRate,match.stake*2,match.serverSeed,feeRate);
    match=await db.pvpMatch.findFirst({where:{id:matchId,OR:[{player1Id:userId},{player2Id:userId}]},include:{player1:{include:{profile:{select:{username:true,avatarUrl:true}}}},player2:{include:{profile:{select:{username:true,avatarUrl:true}}}}}});
    if(!match)throw Object.assign(new Error("Match not found"),{statusCode:404,code:"NOT_FOUND"});
  }
  const isPlayer1=match.player1Id===userId; const opponent=isPlayer1?match.player2:match.player1;
  const totalPool=match.stake*2; const fee=totalPool*await getGameFeeRate(match.gameType as MatchGameType);
  return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,status:match.status,isPlayer1,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:match.resultData?JSON.parse(match.resultData):null,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,winnerPayout:totalPool-fee,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready};
}

`;
s = between(s, "export async function getMatch", "export async function signalReady", getMatch);

s = s.replace(
  'async function recoverUnresolvedImmediateMatches(){const matches=await db.pvpMatch.findMany({where:{status:"active",gameType:{in:["dice_clash","pvp_coinflip"]}},take:100});for(const m of matches){const feeRate=await getGameFeeRate(m.gameType as MatchGameType);const totalPool=m.stake*2;const fee=totalPool*feeRate;if(!m.serverSeed)continue;try{if(m.gameType==="dice_clash")await resolveDiceClash(m.id,m.player1Id,m.player2Id,m.stake,fee,totalPool,m.serverSeed,feeRate);else await resolveCoinFlip(m.id,m.player1Id,m.player2Id,m.stake,fee,totalPool,m.serverSeed,feeRate)}catch{}}}',
  'async function recoverUnresolvedImmediateMatches(){const matches=await db.pvpMatch.findMany({where:{status:"active",gameType:"dice_clash"},take:100});for(const m of matches){const feeRate=await getGameFeeRate("dice_clash");const totalPool=m.stake*2;const fee=totalPool*feeRate;if(!m.serverSeed)continue;try{await resolveDiceClash(m.id,m.player1Id,m.player2Id,m.stake,fee,totalPool,m.serverSeed,feeRate)}catch{}}}'
);

fs.writeFileSync(path, s);
console.log("Applied Coin Flip authoritative side assignment and 8-second settlement.");
