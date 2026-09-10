import fs from "node:fs";
const path = "src/modules/games/matchmaking/matchmaking.routes.ts";
let s = fs.readFileSync(path, "utf8");
s = s.replace('const COIN_FLIP_DURATION_MS = 8000;', 'const COIN_FLIP_DURATION_MS = 12000;');
fs.writeFileSync(path, s);
console.log("Coin Flip authoritative presentation duration set to 12 seconds");
