import fs from "node:fs";
const path = "src/modules/games/matchmaking/matchmaking.service.ts";
let s = fs.readFileSync(path, "utf8");
s = s.replace("async function createGameNotificationasync function createGameNotification", "async function createGameNotification");
fs.writeFileSync(path, s);
console.log("Removed duplicated notification function marker.");
