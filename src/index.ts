#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { merge, processDump } from "./lib/dump.js";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];

  if (!cmd) {
    console.error("Usage: node dist/index.js <path-to-dump.json.gz>");
    console.error("       node dist/index.js merge");
    process.exit(1);
  }

  (cmd === "merge" ? merge() : processDump(cmd)).catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
  });
}
