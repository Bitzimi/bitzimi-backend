import fs from 'node:fs';

const mmPath='src/modules/games/matchmaking/matchmaking.service.ts';
let mm=fs.readFileSync(mmPath,'utf8');
mm=mm.replace('const COIN_FLIP_DURATION_MS = 8_000;','const COIN_FLIP_DURATION_MS = 12_000;');
const oldPrep=`async function prepareCoinFlipMatch(matchId:string,p1Id:string,p2Id:string,serverSeed:string){
  const clientSeed=generateClientSeed(...[p1Id,p2Id].sort(),matchId);
  const coinFlip=deriveCoinFlip(serverSeed,clientSeed,1);
  const winnerId=coinFlip==="heads"?p1Id:p2Id;
  await db.pvpMatch.updateMany({where:{id:matchId,status:"active"},data:{resultData:JSON.stringify({p1Side:"heads",p2Side:"tails",coinFlip,winnerId}),clientSeed,nonce:1}});
}`;
const newPrep=`async function prepareCoinFlipMatch(matchId:string,p1Id:string,p2Id:string,serverSeed:string){
  const clientSeed=generateClientSeed(...[p1Id,p2Id].sort(),matchId);
  const coinFlip=deriveCoinFlip(serverSeed,clientSeed,1);
  const homeIsPlayer1=randomInt(0,2)===0;
  const homePlayerId=homeIsPlayer1?p1Id:p2Id;
  const awayPlayerId=homeIsPlayer1?p2Id:p1Id;
  const p1IsHeads=randomInt(0,2)===0;
  const p1Side=p1IsHeads?"heads":"tails";
  const p2Side=p1IsHeads?"tails":"heads";
  const winnerId=coinFlip===p1Side?p1Id:p2Id;
  await db.pvpMatch.updateMany({where:{id:matchId,status:"active"},data:{resultData:JSON.stringify({homePlayerId,awayPlayerId,p1Side,p2Side,coinFlip,winnerId}),clientSeed,nonce:1}});
}`;
if(!mm.includes(oldPrep)) throw new Error('prepareCoinFlipMatch block not found');
mm=mm.replace(oldPrep,newPrep);
const oldResolveStart=`async function resolveCoinFlip(matchId:string,p1Id:string,p2Id:string,stake:number,fee:number,totalPool:number,serverSeed:string,feeRate:number){
  const existing=await db.pvpMatch.findUnique({where:{id:matchId},select:{resultData:true}});
  const result=existing?.resultData?JSON.parse(existing.resultData):null;
  const coinFlip=result?.coinFlip as "heads"|"tails"|undefined;
  const winnerId=result?.winnerId as string|undefined;
  if(!coinFlip||!winnerId){await prepareCoinFlipMatch(matchId,p1Id,p2Id,serverSeed);return;}
  const loserId=winnerId===p1Id?p2Id:p1Id;
  const payout=totalPool-fee;
  const clientSeed=result?.clientSeed??generateClientSeed(...[p1Id,p2Id].sort(),matchId);`;
const newResolveStart=`async function resolveCoinFlip(matchId:string,p1Id:string,p2Id:string,stake:number,fee:number,totalPool:number,serverSeed:string,feeRate:number){
  const existing=await db.pvpMatch.findUnique({where:{id:matchId},select:{resultData:true,clientSeed:true,serverSeedHash:true}});
  const result=existing?.resultData?JSON.parse(existing.resultData):null;
  const coinFlip=result?.coinFlip as "heads"|"tails"|undefined;
  const winnerId=result?.winnerId as string|undefined;
  if(!coinFlip||!winnerId||!result?.p1Side||!result?.p2Side){await prepareCoinFlipMatch(matchId,p1Id,p2Id,serverSeed);return;}
  const verifiedCoinFlip=deriveCoinFlip(serverSeed,existing?.clientSeed??"",1);
  if(verifiedCoinFlip!==coinFlip||hashServerSeed(serverSeed)!==existing?.serverSeedHash)throw new Error("Coin Flip fairness data mismatch");
  const loserId=winnerId===p1Id?p2Id:p1Id;
  const payout=totalPool-fee;
  const clientSeed=existing?.clientSeed??generateClientSeed(...[p1Id,p2Id].sort(),matchId);`;
if(!mm.includes(oldResolveStart)) throw new Error('resolveCoinFlip start block not found');
mm=mm.replace(oldResolveStart,newResolveStart);
mm=mm.replace('resultData:JSON.stringify({p1Side:"heads",p2Side:"tails",coinFlip,winnerId})','resultData:JSON.stringify({homePlayerId:result.homePlayerId,awayPlayerId:result.awayPlayerId,p1Side:result.p1Side,p2Side:result.p2Side,coinFlip,winnerId})');
const oldReturn=`return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,status:match.status,isPlayer1,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:match.resultData?JSON.parse(match.resultData):null,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready};`;
const newReturn=`const parsedResult=match.resultData?JSON.parse(match.resultData):null;const isHome=parsedResult?.homePlayerId===userId;const playerSide=isPlayer1?parsedResult?.p1Side:parsedResult?.p2Side;const opponentSide=isPlayer1?parsedResult?.p2Side:parsedResult?.p1Side;return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,status:match.status,isPlayer1,isHome,playerSide,opponentSide,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:parsedResult,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready};`;
if(!mm.includes(oldReturn)) throw new Error('getMatch return block not found');
mm=mm.replace(oldReturn,newReturn);
fs.writeFileSync(mmPath,mm);

const qPath='src/modules/games/matchmaking/coinflip-matchmaking.service.ts';
let q=fs.readFileSync(qPath,'utf8');
q=q.replace('where: { userId, gameType, status: "matched", matchId: { not: null } }','where: { userId, gameType, stake, status: "matched", matchId: { not: null } }');
q=q.replace('where: { userId, gameType, status: "reserved", expiresAt: { gt: now } }','where: { userId, gameType, stake, status: "reserved", expiresAt: { gt: now } }');
q=q.replace('where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }','where: { gameType, stake, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }');
q=q.replace('const current = await db.matchmakingQueue.findFirst({ where: { userId, gameType: "pvp_coinflip", status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } },','const current = await db.matchmakingQueue.findFirst({ where: { userId, gameType: "pvp_coinflip", stake: requestedStake, status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } },');
q=q.replace('  void requestedStake;\n','');
fs.writeFileSync(qPath,q);
console.log('Coin Flip backend v2 repair applied');
