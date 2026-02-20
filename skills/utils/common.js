const { execFileSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join, dirname } = require("path");
const { tmpdir } = require("os");

/**
 * Executes a Clawperator command with common error handling and fallback logic.
 */
function runClawperator(execution, deviceId, receiverPkg, clawBinOverride) {
  const commandId = execution.commandId;
  const tmpFile = join(tmpdir(), \`${commandId}.json\`);
  writeFileSync(tmpFile, JSON.stringify(execution));

  let clawBin = clawBinOverride || process.env.CLAW_BIN || "clawperator";
  let cmd = clawBin;
  let args = ["execute", "--execution", tmpFile, "--device-id", deviceId, "--receiver-package", receiverPkg];

  if (cmd === "clawperator") {
    try {
      execFileSync("which", ["clawperator"], { stdio: "ignore" });
    } catch {
      // Robust fallback to relative local path
      cmd = "node";
      const localCli = join(__dirname, "..", "..", "..", "clawperator", "apps", "node", "dist", "cli", "index.js");
      args = [localCli, ...args];
    }
  }

  try {
    const output = execFileSync(cmd, args, { encoding: "utf-8" });
    const result = JSON.parse(output);
    return { ok: true, result, raw: output };
  } catch (e) {
    let detail = e.message;
    if (e.stdout) detail += "\nSTDOUT: " + Buffer.from(e.stdout).toString();
    if (e.stderr) detail += "\nSTDERR: " + Buffer.from(e.stderr).toString();
    return { ok: false, error: detail };
  }
}

/**
 * Robust regex match for UI hierarchy lines that handles attribute order.
 */
function findAttribute(line, attrName) {
  const regex = new RegExp(\`${attrName}=\"([^\"]*)\"\`);
  const match = line.match(regex);
  return match ? match[1] : null;
}

module.exports = {
  runClawperator,
  findAttribute
};
