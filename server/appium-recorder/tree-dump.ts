import { randomUUID } from 'node:crypto';

type ExecText = (command: string, args: string[]) => Promise<string>;

export type HierarchySelector = {
  strategy: 'accessibilityId' | 'id' | 'androidUiAutomator' | 'xpath' | 'bounds';
  value?: string;
};

export type HierarchyBounds = { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number };

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function selectorAttribute(selector: HierarchySelector): { name: string; value: string } | undefined {
  const value = selector.value || '';
  if (selector.strategy === 'id') return { name: 'resource-id', value };
  if (selector.strategy === 'accessibilityId') return { name: 'content-desc', value };
  if (selector.strategy === 'xpath') {
    const match = value.match(/@(resource-id|content-desc|text)\s*=\s*(['"])(.*?)\2/);
    return match ? { name: match[1], value: decodeXml(match[3]) } : undefined;
  }
  if (selector.strategy === 'androidUiAutomator') {
    const match = value.match(/\.(resourceId|description|text)\("((?:\\.|[^"])*)"\)/);
    if (!match) return undefined;
    const name = { resourceId: 'resource-id', description: 'content-desc', text: 'text' }[match[1]];
    return { name, value: match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
  }
  return undefined;
}

export function findHierarchyBounds(xml: string, selectors: HierarchySelector[]) {
  const targets = selectors.map(selectorAttribute).filter((item): item is { name: string; value: string } => Boolean(item));
  if (!targets.length) return undefined;
  for (const tag of xml.match(/<node\b[^>]*>/g) || []) {
    const attributes = new Map(Array.from(tag.matchAll(/([\w:-]+)="([^"]*)"/g), match => [match[1], decodeXml(match[2])]));
    if (!targets.some(target => attributes.get(target.name) === target.value)) continue;
    const bounds = attributes.get('bounds')?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!bounds) continue;
    const [left, top, right, bottom] = bounds.slice(1).map(Number);
    return { left, top, right, bottom, centerX: Math.round((left + right) / 2), centerY: Math.round((top + bottom) / 2) };
  }
  return undefined;
}

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
