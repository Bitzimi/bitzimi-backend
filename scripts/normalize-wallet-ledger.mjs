import fs from "node:fs";
const path = "src/modules/wallets/wallets.service.ts";
let s = fs.readFileSync(path, "utf8");
if (!s.includes('if (entry.type === "game_bet") return;')) {
  const marker = "  const fee = entry.fee ?? 0;\n";
  if (!s.includes(marker)) throw new Error("wallet ledger marker not found");
  s = s.replace(marker, '  if (entry.type === "game_bet") return;\n' + marker);
  fs.writeFileSync(path, s);
}
