import fs from "node:fs";
const path = "src/modules/games/provablyFair.routes.ts";
let s = fs.readFileSync(path, "utf8");
s = s.replaceAll("const settled = !!match.serverSeed;", "const settled = !!match.settledAt;");
fs.writeFileSync(path, s);
console.log("Coin Flip fairness disclosure now follows settlement state");
