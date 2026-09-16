import { execFile } from 'node:child_process';
import { getAdbCommand } from '../android-sdk';

export function stopAppOnDevice(deviceId: string, packageName: string, signal?: AbortSignal) {
  if (!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(packageName)) {
    throw new Error('杀死 APP 需要有效的应用包名');
  }
  // force-stop 只停止指定应用，不使用 pm clear，不删除应用数据。
  return new Promise<string>((resolve, reject) => {
    execFile(getAdbCommand(), ['-s', deviceId, 'shell', 'am', 'force-stop', '--user', 'current', packageName],
      { timeout: 10000, maxBuffer: 1024 * 1024, signal }, (error, stdout, stderr) => {
        const output = `${stdout || ''}\n${stderr || ''}`.trim();
        if (error || /Error:|Exception|Permission Denial/i.test(output)) {
          reject(new Error(`停止 APP 失败（${packageName}）：${output || error?.message}`));
        } else resolve(`已停止 APP 进程：${packageName}（保留应用数据）`);
      });
  });
}
