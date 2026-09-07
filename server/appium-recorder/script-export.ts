import { buffer } from 'node:stream/consumers';
import archiver from 'archiver';
import type { AppiumRecordedScriptRecord } from './repository';

function safeExportName(name: string) {
  const base = Array.from(name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'))
    .slice(0, 80).join('').replace(/[. ]+$/, '') || 'script';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base) ? `_${base}` : base;
}

export async function createAppiumScriptExport(
  root: AppiumRecordedScriptRecord,
  getScript: (id: string) => AppiumRecordedScriptRecord | null,
) {
  const scripts = [root];
  const visited = new Set([root.id]);
  // 按脚本 ID 去重，既保留所有分支的依赖，也避免重复引用和循环连接无限展开。
  for (const script of scripts) {
    for (const step of script.steps) {
      if (step.type !== 'runScript') continue;
      const targetId = step.value || '';
      if (!targetId) throw new Error(`脚本「${script.name}」的「${step.label}」缺少连接脚本 ID，无法导出`);
      if (visited.has(targetId)) continue;
      const target = getScript(targetId);
      if (!target) throw new Error(`脚本「${script.name}」连接的脚本不存在（${targetId}），无法导出完整脚本包`);
      visited.add(targetId);
      scripts.push(target);
    }
  }

  const exportedAt = new Date().toISOString();
  const serialize = (script: AppiumRecordedScriptRecord) => JSON.stringify({
    schemaVersion: 1,
    exportedAt,
    script: {
      id: script.id,
      name: script.name,
      appPackage: script.appPackage,
      appActivity: script.appActivity,
      deviceId: script.deviceId,
      steps: script.steps,
    },
  }, null, 2);
  const baseName = safeExportName(root.name);
  if (!root.steps.some((step) => step.type === 'runScript')) {
    return {
      fileName: `${baseName}.json`,
      contentType: 'application/json; charset=utf-8',
      body: Buffer.from(serialize(root)),
    };
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  const usedNames = new Set<string>();
  for (const script of scripts) {
    const name = safeExportName(script.name);
    let fileName = `${name}.json`;
    let suffix = 2;
    // 清理非法字符后可能重名，Windows 解压时还需忽略大小写进行去重。
    while (usedNames.has(fileName.toLowerCase())) fileName = `${name} (${suffix++}).json`;
    usedNames.add(fileName.toLowerCase());
    archive.append(serialize(script), { name: fileName });
  }
  // 生成完整压缩包后再发送响应，压缩失败仍可返回普通 JSON 错误。
  const [body] = await Promise.all([buffer(archive), archive.finalize()]);
  return { fileName: `${baseName}.zip`, contentType: 'application/zip', body };
}
