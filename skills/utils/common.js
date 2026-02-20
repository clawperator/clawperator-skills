const { execFileSync } = require('child_process');
const { writeFileSync, existsSync, unlinkSync } = require('fs');
const { join, resolve } = require('path');
const { tmpdir } = require('os');

function runClawperator(execution, deviceId, receiverPkg, clawBinOverride) {
  const commandId = execution.commandId;
  const tmpFile = join(tmpdir(), commandId + '.json');
  writeFileSync(tmpFile, JSON.stringify(execution));

  let clawBin = clawBinOverride || process.env.CLAW_BIN || 'clawperator';
  let cmd = clawBin;
  let args = ['execute', '--execution', tmpFile, '--device-id', deviceId, '--receiver-package', receiverPkg];

  if (cmd === 'clawperator') {
    try {
      execFileSync('which', ['clawperator'], { stdio: 'ignore' });
    } catch (e) {
      const localCli = process.env.CLAW_CLI_PATH || resolve(__dirname, '..', '..', '..', 'clawperator', 'apps', 'node', 'dist', 'cli', 'index.js');
      if (existsSync(localCli)) {
        cmd = 'node';
        args = [localCli, ...args];
      } else {
        return { ok: false, error: 'Clawperator binary not found' };
      }
    }
  }

  try {
    const output = execFileSync(cmd, args, { encoding: 'utf-8' });
    // unlinkSync(tmpFile); // Uncomment to enable cleanup
    const result = JSON.parse(output);
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
