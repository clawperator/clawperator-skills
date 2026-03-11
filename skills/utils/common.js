const { execFileSync } = require('child_process');
const { writeFileSync, existsSync, unlinkSync } = require('fs');
const { join, resolve } = require('path');
const { tmpdir } = require('os');

/**
 * REQ-4.1: Binary preference order:
 *   1. CLAW_BIN env var (explicit override - highest priority)
 *   2. Local sibling build (if present at the expected sibling repo path)
 *   3. Global clawperator binary (fallback)
 *
 * The sibling build is preferred over the global binary so that users with a
 * local checkout automatically get the correct compiled output, which is always
 * in sync with the Android Operator APK. The global binary may lag behind due
 * to npm publish delays.
 *
 * CLAW_CLI_PATH env var overrides the sibling build path lookup.
 */
function resolveClawBin() {
  // 1. Explicit override via CLAW_BIN
  if (process.env.CLAW_BIN) {
    return { cmd: process.env.CLAW_BIN, args: [] };
  }

  // 2. Local sibling build (preferred over global when present)
  const siblingCli = process.env.CLAW_CLI_PATH ||
    resolve(__dirname, '..', '..', '..', 'clawperator', 'apps', 'node', 'dist', 'cli', 'index.js');
  if (existsSync(siblingCli)) {
    process.stderr.write(`[clawperator-skills] INFO: using local sibling build: ${siblingCli}\n`);
    return { cmd: 'node', args: [siblingCli] };
  }

  // 3. Global clawperator binary
  return { cmd: 'clawperator', args: [] };
}

/**
 * REQ-3.1: Check whether any snapshot_ui step in the result indicates extraction
 * failure and emit a diagnostic warning to stderr if so.
 *
 * Checks for the new SNAPSHOT_EXTRACTION_FAILED contract (success:false +
 * data.error === "SNAPSHOT_EXTRACTION_FAILED") as well as the pre-REQ-2.3
 * fallback (success:true with absent or empty data.text) to handle older
 * binaries that predate the contract change.
 */
function warnOnSnapshotExtractionFailure(result) {
  if (!result || !Array.isArray(result.stepResults)) return;

  for (const step of result.stepResults) {
    if (step.actionType !== 'snapshot_ui') continue;

    const isNewContractFailure = !step.success && step.data && step.data.error === 'SNAPSHOT_EXTRACTION_FAILED';
    const isLegacyFailure = step.success && step.data && !step.data.text;

    if (isNewContractFailure || isLegacyFailure) {
      process.stderr.write(
        `[clawperator-skills] WARNING: snapshot_ui step "${step.id}" extraction failed` +
        (isNewContractFailure ? ' (SNAPSHOT_EXTRACTION_FAILED)' : ' (empty data.text)') +
        '. This is a known issue when the globally installed clawperator binary is out\n' +
        'of date with the Android Operator APK.\n' +
        'Fix: reinstall the npm package:\n' +
        '  npm install -g clawperator\n' +
        'Or set CLAW_BIN to a local or updated build:\n' +
        '  export CLAW_BIN=/path/to/clawperator/apps/node/dist/cli/index.js\n' +
        'Or run: clawperator version --check-compat\n'
      );
    }
  }
}

function runClawperator(execution, deviceId, receiverPkg, clawBinOverride) {
  const commandId = execution.commandId;
  const tmpFile = join(tmpdir(), commandId + '.json');
  writeFileSync(tmpFile, JSON.stringify(execution));

  let cmd, extraArgs;
  if (clawBinOverride) {
    cmd = clawBinOverride;
    extraArgs = [];
  } else {
    const resolved = resolveClawBin();
    cmd = resolved.cmd;
    extraArgs = resolved.args;
  }

  const args = [...extraArgs, 'execute', '--execution', tmpFile, '--device-id', deviceId, '--receiver-package', receiverPkg];

  try {
    const output = execFileSync(cmd, args, { encoding: 'utf-8' });
    // unlinkSync(tmpFile); // Uncomment to enable cleanup
    const result = JSON.parse(output);
    warnOnSnapshotExtractionFailure(result);
    return { ok: true, result, raw: output };
  } catch (e) {
    let msg = e.message;
    if (e.stderr) msg += '\nSTDERR: ' + Buffer.from(e.stderr).toString();
    if (e.stdout) msg += '\nSTDOUT: ' + Buffer.from(e.stdout).toString();
    return { ok: false, error: msg };
  }
}

function findAttribute(line, attrName) {
  const regex = new RegExp(attrName + '="([^"]*)"');
  const match = line.match(regex);
  if (!match) return null;
  return match[1] === '' ? null : match[1];
}

module.exports = { runClawperator, findAttribute };
