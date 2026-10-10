import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureArtemisConfig } from './artemis-config.mjs';

const binDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(process.env.ARTEMIS_PROJECT_DIR || resolve(binDir, '../artemis-main'));
if (!existsSync(resolve(projectDir, 'pyproject.toml'))) {
  console.error('找不到 Artemis 源码。请将源码放在 artemis-main，或设置 ARTEMIS_PROJECT_DIR。');
  process.exit(1);
}

ensureArtemisConfig(projectDir);

const child = spawn('uv', ['run', '--project', projectDir, 'python', resolve(binDir, 'artemis-embedded.py')], {
  cwd: projectDir,
  stdio: 'inherit',
  env: { ...process.env, ARTEMIS_PROJECT_DIR: projectDir },
});
child.once('error', error => {
  console.error(`Artemis 启动失败，请确认已安装 uv：${error.message}`);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
