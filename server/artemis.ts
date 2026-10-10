import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appPath } from './paths';

export async function getArtemisVersion() {
  try {
    const projectDir = process.env.ARTEMIS_PROJECT_DIR || appPath('artemis-main');
    const source = await readFile(resolve(projectDir, 'pyproject.toml'), 'utf8');
    const project = source.split(/^\[project\]\s*$/m)[1]?.split(/^\[/m)[0] || '';
    const version = project.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
    return { version: version || '', message: version ? '本地 Artemis 源码版本' : '未找到 Artemis 版本信息' };
  } catch {
    return { version: '', message: '未找到本地 Artemis 源码，请检查 ARTEMIS_PROJECT_DIR' };
  }
}

export async function getArtemisStatus() {
  const configuredUrl = process.env.ARTEMIS_URL || 'http://127.0.0.1:8000';
  try {
    const url = new URL(configuredUrl);
    const response = await fetch(new URL('/api/status', url), {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    const data = await response.json() as { model_info?: unknown };
    if (!response.ok || !data.model_info) throw new Error('服务响应不是 Artemis 控制台');
    const policy = response.headers.get('content-security-policy') || '';
    const ancestors = response.headers.get('x-frame-options')
      ? [] : policy.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/)?.[1].split(/\s+/) || [];
    return { url: url.origin, available: true, ancestors, message: '' };
  } catch {
    return { url: '', available: false, ancestors: [], message: '未连接到 Artemis，请先在项目根目录运行 npm run artemis，并检查 ARTEMIS_URL 配置。' };
  }
}
