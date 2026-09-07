import { randomUUID } from 'node:crypto';

type ExecText = (command: string, args: string[]) => Promise<string>;

export async function readFreshWindowHierarchy(deviceId: string, adb: string, execText: ExecText) {
  // dump 失败可能仍以 0 退出。每次独立文件，避免误读上一次成功抓取的树。
  const remotePath = `/data/local/tmp/midscene_uidump_${randomUUID()}.xml`;
  const run = (args: string[]) => execText(adb, ['-s', deviceId, ...args]);
  try {
    const output = await run(['shell', 'uiautomator', 'dump', remotePath]);
    if (/ERROR:|could not|failed/i.test(output)) throw new Error(output.trim());
    const xml = await run(['shell', 'cat', remotePath]);
    if (!xml.includes('<hierarchy') || !xml.includes('</hierarchy>')) {
      throw new Error('设备未返回有效的组件树');
    }
    return xml;
  } catch (error) {
    throw new Error(`刷新组件树失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await run(['shell', 'rm', '-f', remotePath]).catch(() => undefined);
  }
}
