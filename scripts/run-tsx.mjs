import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tsxCli = resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const childEnv = { ...process.env };

if (process.platform === 'win32') {
  const preload = resolve(projectRoot, 'scripts/tsx-windows-preload.cjs');
  const preloadOption = `--require=${preload}`;
  childEnv.NODE_OPTIONS = [childEnv.NODE_OPTIONS, preloadOption].filter(Boolean).join(' ');
}

const child = spawn(process.execPath, [tsxCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: childEnv,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
