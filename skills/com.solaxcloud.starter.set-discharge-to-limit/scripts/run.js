#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [, , ...args] = process.argv;
const replayRunPath = fileURLToPath(
  new URL("../../com.solaxcloud.starter.set-discharge-to-limit-replay/scripts/run.js", import.meta.url)
);
const result = spawnSync(process.execPath, [replayRunPath, ...args], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
