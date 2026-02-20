import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = process.argv[3] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";
let clawBin = process.env.CLAW_BIN || "clawperator";

if (!deviceId) {
  console.error("Usage: npx tsx get_bedroom_temperature.ts <device_id> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-switchbot-temp-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 60000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.theswitchbot.switchbot" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.theswitchbot.switchbot" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 4000 } },
    { id: "read_temp", type: "read_text", params: { matcher: { resourceId: "com.theswitchbot.switchbot:id/tvTemp" } } }
  ]
};

const tmpFile = join(tmpdir(), `${commandId}.json`);
writeFileSync(tmpFile, JSON.stringify(execution));

try {
  let cmd = clawBin;
  let args = ["execute", "--execution", tmpFile, "--device-id", deviceId, "--receiver-package", receiverPkg];
  
  if (clawBin === "clawperator") {
    try {
      execFileSync("command", ["-v", "clawperator"]);
    } catch {
      cmd = "node";
      args = [join(__dirname, "..", "..", "..", "..", "clawperator", "apps", "node", "dist", "cli", "index.js"), ...args];
    }
  }

  const output = execFileSync(cmd, args, { encoding: "utf-8" });
  const result = JSON.parse(output);

  const snapStep = result.envelope.stepResults.find((s: any) => s.id === "read_temp");
  const temp = snapStep && snapStep.data ? snapStep.data.text : null;

  if (temp) {
    console.log(`✅ Bedroom temperature: ${temp}`);
  } else {
    console.error("⚠️ Could not parse bedroom temperature");
    console.error(`Raw result: ${output}`);
    process.exit(2);
  }
} catch (e: any) {
  console.error("⚠️ Skill execution failed");
  if (e.stdout) console.error(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(2);
}
