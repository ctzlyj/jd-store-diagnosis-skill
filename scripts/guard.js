const { execFileSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

function zguard(port = 9224, mode = 'bottom') {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'zguard.ps1'), '-Port', String(port), '-Mode', mode], { stdio: 'ignore', timeout: 40000 });
  } catch (e) { /* non-fatal */ }
}

// Continuous guard: keeps the shop browser window pinned to the bottom of the
// z-order for the whole capture, so nothing (CDP tab creation, navigation,
// Chrome internals) can ever raise it over the user's working window.
// Returns a handle whose .stop() ends the loop early.
function zguardLoop(port = 9224, seconds = 600) {
  const stopFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zguard-')), 'stop');
  let child = null;
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'zguard-loop.ps1'),
      '-Port', String(port), '-Seconds', String(seconds), '-StopFile', stopFile,
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch (e) { /* non-fatal */ }
  return {
    stop() {
      try { fs.writeFileSync(stopFile, 'x'); } catch (e) {}
      try { if (child) child.kill(); } catch (e) {}
    },
  };
}

function portFromCdp(CDP) { try { return new URL(CDP).port || '9222'; } catch (e) { return '9224'; } }

module.exports = { zguard, zguardLoop, portFromCdp };
