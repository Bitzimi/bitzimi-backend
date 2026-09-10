import fs from "node:fs";

// Coin Flip integrity is now implemented by the dedicated backend service and
// final build verification patch. This legacy source-mutating rewrite used to
// recreate immediate-settlement behavior, so it is intentionally disabled.
void fs;
console.log("Skipped legacy game-integrity-v2 source rewrite.");
