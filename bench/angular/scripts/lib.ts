// Builds the library in ../.., packs it into vendor/ and installs that tarball.
// `npm install` alone keeps a stale copy when the version did not change.
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const run = (cmd: string, cwd = root) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

run('npm run build', join(root, '../..'));
const [{ filename }] = JSON.parse(run('npm pack ../.. --pack-destination vendor --json')) as Array<{ filename: string }>;
run(`npm install ./vendor/${filename}`);
console.log(`installed vendor/${filename}`);
