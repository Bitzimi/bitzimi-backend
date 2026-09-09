import fs from "node:fs";
const lines = fs.readFileSync("src/modules/games/matchmaking/matchmaking.service.ts", "utf8").split("\n");
console.log(lines.slice(64, 76).map((x, i) => `${i + 65}: ${x}`).join("\n"));
