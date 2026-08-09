'use strict';

const fs = require('fs');
const path = require('path');
const { gitDir } = require('../git');
const { readSession, listTurns } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const turns = listTurns(session.session_id);

  const gd = gitDir();
  const hookPath = path.join(gd, 'hooks', 'post-commit');
  let hookStatus = 'missing';
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf8');
    hookStatus = content.includes('git-turn') ? 'installed' : 'not from git-turn';
  }

  console.log('Session:  ' + session.session_id);
  console.log('Branch:   ' + session.branch);
  console.log('Turns:    ' + turns.length);
  console.log('Started:  ' + session.started);
  console.log('Hook:     ' + hookStatus);
}

module.exports = { run };
