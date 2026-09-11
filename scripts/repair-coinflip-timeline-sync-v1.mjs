import fs from 'node:fs';

const path='src/modules/games/matchmaking/matchmaking.service.ts';
let s=fs.readFileSync(path,'utf8');

if(!s.includes('const COIN_FLIP_SIDES_DURATION_MS')){
  if(!s.includes('const COIN_FLIP_DURATION_MS = 12_000;')) throw new Error('Expected 12-second Coin Flip duration constant not found');
  s=s.replace(
    'const COIN_FLIP_DURATION_MS = 12_000;',
    'const COIN_FLIP_SIDES_DURATION_MS = 12_000;\nconst COIN_FLIP_FLIP_DURATION_MS = 5_000;\nconst COIN_FLIP_DURATION_MS = COIN_FLIP_SIDES_DURATION_MS + COIN_FLIP_FLIP_DURATION_MS;'
  );
}

// Expose authoritative server timeline/phase to both clients. The server clock and
// persisted match creation time are the source of truth; the browser never chooses
// when the phase changes or when settlement is allowed.
const marker='  const isPlayer1=match.player1Id===userId; const opponent=isPlayer1?match.player2:match.player1;';
if(!s.includes(marker)) throw new Error('Coin Flip getMatch marker not found');
if(!s.includes('const coinFlipElapsedMs=')){
  s=s.replace(marker,`  const isPlayer1=match.player1Id===userId; const opponent=isPlayer1?match.player2:match.player1;
  const coinFlipElapsedMs=match.gameType==='pvp_coinflip'?Math.max(0,Date.now()-match.createdAt.getTime()):0;
  const coinFlipPhase=match.gameType!=='pvp_coinflip'||match.status==='settled'?'settled':coinFlipElapsedMs<COIN_FLIP_SIDES_DURATION_MS?'side_assignment':'flipping';`);
}

const oldReturn='return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,status:match.status,isPlayer1,isHome,playerSide,opponentSide,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:parsedResult,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready};';
const newReturn='return{matchId:match.id,gameType:match.gameType,stake:match.stake,totalPool,platformFee:fee,winnerPayout:totalPool-fee,status:match.status,isPlayer1,isHome,playerSide,opponentSide,opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null},result:parsedResult,winnerId:match.winnerId,youWon:match.winnerId===userId,payout:match.winnerId===userId?totalPool-fee:0,createdAt:match.createdAt.toISOString(),settledAt:match.settledAt?.toISOString()??null,signalSentAt:match.signalSentAt?.toISOString()??null,serverNow:new Date().toISOString(),animationElapsedMs:match.gameType==="pvp_coinflip"?Math.min(COIN_FLIP_DURATION_MS,Math.max(0,Date.now()-match.createdAt.getTime())):0,sideAssignmentDurationMs:match.gameType==="pvp_coinflip"?COIN_FLIP_SIDES_DURATION_MS:0,flipDurationMs:match.gameType==="pvp_coinflip"?COIN_FLIP_FLIP_DURATION_MS:0,animationDurationMs:match.gameType==="pvp_coinflip"?COIN_FLIP_DURATION_MS:0,phase:coinFlipPhase,yourReady:isPlayer1?match.player1Ready:match.player2Ready,opponentReady:isPlayer1?match.player2Ready:match.player1Ready};';
if(!s.includes(oldReturn)) throw new Error('Expected repaired getMatch return not found');
s=s.replace(oldReturn,newReturn);

// Ensure the match endpoint also settles a due match at the authoritative 17s mark
// before returning it, so both clients converge even without the background worker.
s=s.replace(
  'if(match.gameType==="pvp_coinflip"&&match.status==="active"&&match.createdAt.getTime()<=Date.now()-COIN_FLIP_DURATION_MS&&match.serverSeed){',
  'if(match.gameType==="pvp_coinflip"&&match.status==="active"&&match.createdAt.getTime()<=Date.now()-COIN_FLIP_DURATION_MS&&match.serverSeed){'
);

fs.writeFileSync(path,s);
console.log('Coin Flip authoritative timeline/synchronization repair applied');
