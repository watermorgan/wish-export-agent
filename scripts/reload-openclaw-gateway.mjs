import { execFileSync } from 'node:child_process';

const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/ai.openclaw.gateway`], {
  stdio: 'inherit'
});
console.log('openclaw gateway reloaded');
