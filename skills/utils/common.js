const { execFileSync } = require('child_process');
const { writeFileSync, existsSync, unlinkSync } = require('fs');
const { join, resolve, extname } = require('path');
const { tmpdir } = require('os');

/**
 * Binary preference order:
 *   1. CLAWPERATOR_BIN env var (explicit override - highest priority)
 *   2. Local sibling build (if present at the expected sibling repo path)
 *   3. Global clawperator binary (fallback)
 *
 * The sibling build is preferred over the global binary so that users with a
 * local checkout automatically get the correct compiled output, which is always
 * in sync with the Android Operator APK. The global binary may lag behind due
 * to npm publish delays.
 *
 * CLAWPERATOR_CLI_PATH env var overrides the sibling build path lookup.
 */
function resolveClawperatorBin() {
  // 1. Explicit override via CLAWPERATOR_BIN (new canonical name)
  const explicitBin = process.env.CLAWPERATOR_BIN;
  if (explicitBin) {
    if (existsSync(explicitBin)) {
      if (extname(explicitBin) === '.js') {
        return { cmd: process.execPath, args: [explicitBin] };
      }
      return { cmd: explicitBin, args: [] };
    }
    const parsedBin = parseCommandSpec(explicitBin);
    if (parsedBin !== null) {
      return parsedBin;
    }
    return { cmd: explicitBin, args: [] };
  }

  // 2. Local sibling build (preferred over global when present)
  const siblingCli = process.env.CLAWPERATOR_CLI_PATH ||
    resolve(__dirname, '..', '..', '..', 'clawperator', 'apps', 'node', 'dist', 'cli', 'index.js');
  if (existsSync(siblingCli)) {
    process.stderr.write(`[clawperator-skills] INFO: using local sibling build: ${siblingCli}\n`);
    return { cmd: 'node', args: [siblingCli] };
  }

  // 3. Global clawperator binary
  return { cmd: 'clawperator', args: [] };
}

/**
 * Parse a shell-style command specification into an executable and arguments.
 *
 * This accepts the `node "/path/to/index.js"` shape emitted by the Node CLI
 * while still preserving plain executable paths as a single command.
 */
function parseCommandSpec(commandSpec) {
  const parts = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < commandSpec.length; i += 1) {
    const char = commandSpec[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < commandSpec.length) {
        i += 1;
        current += commandSpec[i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== '') {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return null;
  }

  if (current !== '') {
    parts.push(current);
  }

  if (parts.length === 0) {
    return null;
  }

  return { cmd: parts[0], args: parts.slice(1) };
}

/**
 * Resolve the operator package for skill execution.
 *
 * Preference order:
 *   1. Explicit operatorPkg parameter passed to runClawperator()
 *   2. CLAWPERATOR_OPERATOR_PACKAGE env var
 *   3. Default release package 'com.clawperator.operator'
 */
function resolveOperatorPackage(explicitPkg) {
  if (explicitPkg !== undefined && explicitPkg !== null && explicitPkg !== "") {
    return explicitPkg;
  }
  const envPkg = process.env.CLAWPERATOR_OPERATOR_PACKAGE;
  if (envPkg !== undefined && envPkg !== "") {
    return envPkg;
  }
  return 'com.clawperator.operator';
}

/**
 * Check whether any snapshot_ui step in the result indicates extraction failure
 * and emit a diagnostic warning to stderr if so.
 *
 * Checks for the new SNAPSHOT_EXTRACTION_FAILED contract (success:false +
 * data.error === "SNAPSHOT_EXTRACTION_FAILED") as well as the older
 * fallback (success:true with absent or empty data.text) to handle older
 * binaries that predate the contract change.
 */
function warnOnSnapshotExtractionFailure(result) {
  const envelope = result && result.envelope;
  if (!envelope || !Array.isArray(envelope.stepResults)) return;

  for (const step of envelope.stepResults) {
    if (step.actionType !== 'snapshot_ui') continue;

    const isNewContractFailure = !step.success && step.data && step.data.error === 'SNAPSHOT_EXTRACTION_FAILED';
    const isLegacyFailure = step.success && step.data && !step.data.text;

    if (isNewContractFailure || isLegacyFailure) {
      process.stderr.write(
        `[clawperator-skills] WARNING: snapshot_ui step "${step.id}" extraction failed` +
        (isNewContractFailure ? ' (SNAPSHOT_EXTRACTION_FAILED)' : ' (empty data.text)') +
        '. This is a known issue when the clawperator binary is out\n' +
        'of date with the Android Operator APK.\n' +
        'Fix: set CLAWPERATOR_BIN to the local build:\n' +
        '  export CLAWPERATOR_BIN=/path/to/clawperator/apps/node/dist/cli/index.js\n' +
        'Or reinstall the npm package:\n' +
        '  npm install -g clawperator\n' +
        'Then verify with: clawperator snapshot --device <id>\n'
      );
    }
  }
}

function runClawperator(execution, deviceId, operatorPkg, clawBinOverride) {
  const commandId = execution.commandId;
  const tmpFile = join(tmpdir(), commandId + '.json');
  writeFileSync(tmpFile, JSON.stringify(execution));

  let cmd, extraArgs;
  if (clawBinOverride) {
    cmd = clawBinOverride;
    extraArgs = [];
  } else {
    const resolved = resolveClawperatorBin();
    cmd = resolved.cmd;
    extraArgs = resolved.args;
  }

  // Resolve operator package using the new precedence rules.
  const effectiveOperatorPkg = resolveOperatorPackage(operatorPkg);

  const args = [...extraArgs, 'exec', tmpFile, '--device', deviceId, '--operator-package', effectiveOperatorPkg];

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

function logSkillProgress(skillId, message) {
  console.log(`[skill:${skillId}] ${message}`);
}

/**
 * Run a Clawperator CLI command (screenshot, snapshot, click, etc.)
 * Returns { ok: boolean, result: Buffer | string, error: string }
 */
function runClawperatorCommand(command, args, { encoding = null, throwOnNonZero = true } = {}) {
  const resolved = resolveClawperatorBin();
  const cmd = resolved.cmd;
  const cmdArgs = [...resolved.args, command, ...args];

  try {
    const output = execFileSync(cmd, cmdArgs, {
      encoding: encoding || 'buffer',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { ok: true, result: output };
  } catch (e) {
    if (!throwOnNonZero && e.status && e.status !== 0) {
      return { ok: false, error: e.message, exitCode: e.status };
    }
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

module.exports = { runClawperator, runClawperatorCommand, findAttribute, resolveClawperatorBin, resolveOperatorPackage, parseCommandSpec, logSkillProgress };
