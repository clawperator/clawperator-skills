import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const state = process.argv[2] || "on";
const deviceId = process.argv[3] || process.env.DEVICE_ID;
const acTileName = process.argv[4] || process.env.AC_TILE_NAME;

if (!deviceId || !acTileName) {
  console.error("Usage: npx tsx set_aircon.ts <on|off> <device_id> <ac_tile_name>");
  process.exit(1);
}

const statusScript = join(__dirname, "..", "..", "com.google.android.apps.chromecast.app.get-aircon-status", "scripts", "get_aircon_status.ts");

try {
  console.log(`Checking current state for ${acTileName}...`);
  const output = execFileSync("npx", ["-y", "tsx", statusScript, deviceId, acTileName], { encoding: "utf-8" });
  console.log(output.trim());

  if (output.toLowerCase().includes(`power=${state.toLowerCase()}`)) {
    console.log(`✅ Already in requested state: ${state}`);
    process.exit(0);
  }

  console.log("ℹ️ Direct semantic ac:on/ac:off invocation is not exposed via local debug broadcast yet.");
  console.log("ℹ️ Use the production command pipeline for state-changing actions.");
} catch (e: any) {
  console.error("⚠️ Failed to verify AC state");
  if (e.stdout) console.error(e.stdout);
  process.exit(2);
}
