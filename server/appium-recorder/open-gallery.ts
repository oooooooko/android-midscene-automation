import { execFile } from 'node:child_process';
import { getAdbCommand } from '../android-sdk';

const MAIN = 'android.intent.action.MAIN';
const GALLERY = 'android.intent.category.APP_GALLERY';
const LAUNCHER = 'android.intent.category.LAUNCHER';
// 仅检查已安装的相册应用，不安装应用，也不打开照片选择器。
const galleryPackages = [
  'com.android.gallery3d', 'com.miui.gallery', 'com.sec.android.gallery3d',
  'com.huawei.photos', 'com.hihonor.photos', 'com.coloros.gallery3d',
  'com.oplus.gallery', 'com.vivo.gallery', 'com.google.android.apps.photos',
];

function components(output: string) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => (
    /^[\w.]+\/[\w.$]+$/.test(line) && !/(?:Resolver|Chooser)Activity/.test(line)
  ));
}

export async function openGalleryOnDevice(deviceId: string, signal?: AbortSignal) {
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(getAdbCommand(), ['-s', deviceId, 'shell', ...args], {
      timeout: 20000, maxBuffer: 4 * 1024 * 1024, signal,
    }, (error, stdout, stderr) => {
      if (error) { reject(error); return; }
      resolve(`${stdout}\n${stderr}`.trim());
    });
  });
  const query = (command: string, category: string, packageName?: string) => run([
    'cmd', 'package', command, '--brief', '--user', 'current', '-a', MAIN, '-c', category,
    ...(packageName ? ['-p', packageName] : []),
  ]);
  let component = components(await query('resolve-activity', GALLERY))[0];
  if (!component) component = components(await query('query-activities', GALLERY))[0];
  if (!component) {
    const installed = new Set((await run(['pm', 'list', 'packages', '--user', 'current']))
      .split(/\r?\n/).map((line) => line.trim().replace(/^package:/, '')));
    for (const packageName of galleryPackages) {
      if (!installed.has(packageName)) continue;
      component = components(await query('resolve-activity', LAUNCHER, packageName))
        .find((item) => item.startsWith(`${packageName}/`));
      if (component) break;
    }
  }
  if (!component) throw new Error('未找到可启动的相册应用，请检查手机是否安装并启用了相册');
  const output = await run(['am', 'start', '-W', '--user', 'current', '-a', MAIN, '-n', component]);
  // am start 某些错误仍返回 0，不能只检查进程退出码。
  if (!/^Status:\s*ok\s*$/im.test(output) || /Error:|Exception|Permission Denial/i.test(output)) {
    throw new Error(`启动相册失败：${output || component}`);
  }
  return `已启动相册：${component}`;
}
