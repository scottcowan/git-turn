'use strict';

const fs = require('fs');
const path = require('path');
const { gitDir, hooksDir, gitSafe } = require('../git');
const { readSession, listTurns } = require('../session');

function checkHookStatus() {
  const hooksPathCfg = gitSafe(['config', '--get', 'core.hooksPath']);
  const activePath = path.join(hooksDir(), 'post-commit');

  let hookStatus = 'missing';
  if (fs.existsSync(activePath)) {
    const content = fs.readFileSync(activePath, 'utf8');
    hookStatus = content.includes('git-turn') ? 'installed' : 'not from git-turn';
  }

  // core.hooksPath (Husky, lefthook, ...) redirects git away from the default
  // hooks dir. If a git-turn hook is sitting there unused, it will never fire —
  // flag that explicitly instead of reporting a misleading "installed"/"missing".
  if (hooksPathCfg && hookStatus !== 'installed') {
    const gd = gitDir();
    const common = gitSafe(['rev-parse', '--git-common-dir']) || gd;
    const defaultPath = path.join(common, 'hooks', 'post-commit');
    if (defaultPath !== activePath && fs.existsSync(defaultPath)) {
      const defaultContent = fs.readFileSync(defaultPath, 'utf8');
      if (defaultContent.includes('git-turn')) {
        return `shadowed by core.hooksPath=${hooksPathCfg} (hook exists at ${defaultPath} but git never reads it — re-run 'git turn init')`;
      }
    }
  }

  return hookStatus;
}

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const turns = listTurns(session.session_id);
  const hookStatus = checkHookStatus();

  console.log('Session:  ' + session.session_id);
  console.log('Branch:   ' + session.branch);
  console.log('Turns:    ' + turns.length);
  console.log('Started:  ' + session.started);
  console.log('Hook:     ' + hookStatus);
}

module.exports = { run };
