'use strict';

const fs = require('fs');
const path = require('path');
const { gitDir, git } = require('../git');
const { newSession, ensureDirs } = require('../session');

const HOOK_SCRIPT = `#!/usr/bin/env node
// git-turn post-commit hook
// Installed by: git turn init
require('git-turn/src/hooks/post-commit').run();
`;

function run(args) {
  const gd = gitDir();
  const hooksDir = path.join(gd, 'hooks');
  const hookPath = path.join(hooksDir, 'post-commit');

  // Check not already installed
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes('git-turn')) {
      console.log('git turn: hook already installed');
    } else {
      console.error('git turn: post-commit hook already exists (not from git-turn)');
      console.error(`Edit ${hookPath} to add: require('git-turn/src/hooks/post-commit').run();`);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
    console.log(`✓ Installed post-commit hook: ${hookPath}`);
  }

  // Set notes.expiry=never
  git(['config', 'notes.expiry', 'never']);
  console.log('✓ Set notes.expiry=never');

  // Set up log decoration
  git(['config', '--add', 'log.showSignature', 'false']);

  // Create session
  ensureDirs();
  const session = newSession();
  console.log(`✓ Started session: ${session.session_id}`);
  console.log(`✓ Captured ${session.preexisting_untracked.length} pre-existing untracked files`);

  console.log('\ngit turn is ready. Run `git turn log` after your next agent session.');
}

module.exports = { run };
