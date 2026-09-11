import fs from 'node:fs';

const path='src/modules/games/matchmaking/coinflip-matchmaking.service.ts';
let s=fs.readFileSync(path,'utf8');
const old='if (!match || (match.status !== "active" && match.status !== "settled")) return { status: "cancelled" as const };';
const next='if (!match || match.status !== "active") return { status: "cancelled" as const };';
if(s.includes(old)) s=s.replace(old,next);
else if(!s.includes(next)) throw new Error('Coin Flip recovery status guard not found');
fs.writeFileSync(path,s);
console.log('Coin Flip recovery now resumes active matches only');
