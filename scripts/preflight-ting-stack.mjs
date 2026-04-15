import { execFileSync } from 'node:child_process';

function run(label, command, args) {
  console.log(`\n=== ${label} ===`);
  execFileSync(command, args, { stdio: 'inherit' });
}

run('service:status', 'npm', ['run', 'service:status']);
run('service:health', 'npm', ['run', 'service:health']);
run('service:sync-ting-mcp', 'npm', ['run', 'service:sync-ting-mcp']);
run('gateway:reload', 'npm', ['run', 'service:reload-gateway']);
