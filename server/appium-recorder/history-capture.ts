import { execFile } from 'node:child_process';
import { getAdbCommand } from '../android-sdk';
import { htmlImageUrl, type AppiumReplayFrame, type AppiumReplayVisualCheck } from './report';
import type { HistoryNode } from '../../src/appium-recorder/run-history';

export function readAppVersion(deviceId: string, appPackage: string): Promise<string> {
  if (!appPackage) return Promise.resolve('');
  return new Promise(resolve => {
    execFile(getAdbCommand(), ['-s', deviceId, 'shell', 'dumpsys', 'package', appPackage], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve('');
      const name = stdout.match(/\bversionName=([^\r\n]+)/)?.[1]?.trim();
      const code = stdout.match(/\bversionCode=(\d+)/)?.[1];
      resolve(name ? `${name}${code ? ` (${code})` : ''}` : '');
    });
  });
}

export function captureHistoryFrames(frames: AppiumReplayFrame[], checks: AppiumReplayVisualCheck[], events = frames) {
  const cache = new Map<string, string>();
  const nodes: HistoryNode[] = [];
  const pending = new Map<string, AppiumReplayFrame>();
  for (const frame of events) {
    const key = frame.nodeId;
    if (frame.phase === 'before') { pending.set(key, frame); continue; }
    const start = pending.get(key);
    pending.delete(key);
    if (frame.phase !== 'stopped') nodes.push({ key, label: `${frame.scriptName} / ${frame.nodeLabel}`, failed: frame.phase === 'error', durationMs: start ? Math.max(0, Date.parse(frame.capturedAt) - Date.parse(start.capturedAt)) : null });
  }
  for (const check of checks.filter(check => check.status === 'failed')) {
    const node = nodes.find(node => node.key === check.nodeId);
    if (node) node.failed = true;
  }
  return { nodes, frames: frames.map(frame => ({ key: frame.nodeId, label: frame.nodeLabel, phase: frame.phase, capturedAt: frame.capturedAt, imageUrl: htmlImageUrl(frame.imageBase64, cache) })) };
}
