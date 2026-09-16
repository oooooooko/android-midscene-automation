import { execFile } from 'node:child_process';
import type { AndroidDeviceDetails } from '../src/types';

export function parseAndroidDeviceInfo(properties: string, size: string, deviceName = ''): AndroidDeviceDetails {
  const values = new Map([...properties.matchAll(/^\[([^\]]+)\]: \[(.*)\]\s*$/gm)].map(match => [match[1], match[2]]));
  const get = (...keys: string[]) => keys.map(key => values.get(key)?.trim()).find(Boolean) || '';
  const physical = size.match(/Physical size:\s*(\d+)x(\d+)/i);
  const current = size.match(/Override size:\s*(\d+)x(\d+)/i) || physical;
  const resolution = (match: RegExpMatchArray | null) => match ? `${match[1]} × ${match[2]}` : '';
  return {
    name: deviceName.trim() && deviceName.trim() !== 'null' ? deviceName.trim() : get('persist.sys.device_name', 'ro.product.marketname', 'ro.product.model'),
    brand: get('ro.product.brand', 'ro.product.manufacturer'), model: get('ro.product.model'),
    processor: get('ro.soc.model', 'ro.board.platform', 'ro.hardware'),
    androidVersion: get('ro.build.version.release'), physicalResolution: resolution(physical), resolution: resolution(current),
  };
}

export async function readAndroidDeviceInfo(deviceId: string, adb: string) {
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(adb, ['-s', deviceId, 'shell', ...args], { timeout: 4000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });
  const properties = await run(['getprop']);
  const size = await run(['wm', 'size']).catch(() => '');
  const name = await run(['settings', 'get', 'global', 'device_name']).catch(() => '');
  return parseAndroidDeviceInfo(properties, size, name);
}
