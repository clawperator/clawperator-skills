#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const replayScript = join(
  currentDir,
  "..",
  "..",
  "com.solaxcloud.starter.set-discharge-to-limit-replay",
  "scripts",
  "run.js"
);

console.error(
  "com.solaxcloud.starter.set-discharge-to-limit is deprecated; delegating to com.solaxcloud.starter.set-discharge-to-limit-replay."
);

try {
  execFileSync(process.execPath, [replayScript, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
} catch (err) {
  process.exit(typeof err?.status === "number" ? err.status : 1);
}
