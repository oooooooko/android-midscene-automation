import type { AppiumBounds, AppiumNode, AppiumSelector } from './types';

type SelectorCounts = {
  contentDesc: Map<string, number>;
  resourceId: Map<string, number>;
  textClass: Map<string, number>;
};

function attr(element: Element, name: string) {
  return element.getAttribute(name) || '';
}

function parseBounds(value: string): AppiumBounds | undefined {
  const match = value.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return undefined;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
  };
}

function escapeUiAutomatorText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function textClassKey(element: Element) {
  return `${attr(element, 'text')}|${attr(element, 'class')}`;
}

function withCount(selector: AppiumSelector, count: number): AppiumSelector {
  return {
    ...selector,
    unique: count === 1,
    matchCount: count,
    source: selector.source || 'node',
  };
}

function buildSelector(element: Element, counts: SelectorCounts, bounds?: AppiumBounds): AppiumSelector {
  const contentDesc = attr(element, 'content-desc');
  const resourceId = attr(element, 'resource-id');
  const text = attr(element, 'text');
  const className = attr(element, 'class');
  if (contentDesc) return withCount({ strategy: 'accessibilityId', value: contentDesc }, counts.contentDesc.get(contentDesc) || 1);
  if (resourceId) return withCount({ strategy: 'id', value: resourceId }, counts.resourceId.get(resourceId) || 1);
  if (text) {
    const classClause = className ? `.className("${escapeUiAutomatorText(className)}")` : '';
    return withCount(
      { strategy: 'androidUiAutomator', value: `new UiSelector().text("${escapeUiAutomatorText(text)}")${classClause}` },
      counts.textClass.get(textClassKey(element)) || 1,
    );
  }
  if (bounds) return { strategy: 'bounds', centerX: bounds.centerX, centerY: bounds.centerY, unique: false, matchCount: 0, source: 'fallback' };
  return { strategy: 'xpath', value: '', unique: false, matchCount: 0 };
}

function nodeLabel(element: Element) {
  return attr(element, 'resource-id')
    || attr(element, 'content-desc')
    || attr(element, 'text')
    || attr(element, 'class')
    || element.tagName;
}

function elementChildren(element: Element) {
  return Array.from(element.children).filter((child) => child.tagName === 'node');
}

function escapeXpathValue(value: string) {
  return value.replace(/'/g, "&apos;");
}

function transformNode(
  element: Element,
  parentPath: string,
  index: number,
  resourceIdCounts: Map<string, number>,
  counts: SelectorCounts,
  nearestContextSelector?: AppiumSelector,
): AppiumNode {
  const bounds = parseBounds(attr(element, 'bounds'));
  const className = attr(element, 'class') || element.tagName;
  const resourceId = attr(element, 'resource-id');
  const siblings = element.parentElement ? elementChildren(element.parentElement) : [element];
  const sameClassIndex = siblings
    .slice(0, index + 1)
    .filter((sibling) => (attr(sibling, 'class') || sibling.tagName) === className).length;
  const xpath = resourceId && resourceIdCounts.get(resourceId) === 1
    ? `//*[@resource-id='${escapeXpathValue(resourceId)}']`
    : `${parentPath}/${className}[${sameClassIndex}]`;
  const selector = buildSelector(element, counts, bounds);
  const selfContextSelector: AppiumSelector = selector.unique && selector.strategy !== 'bounds'
    ? selector
    : { strategy: 'xpath', value: xpath, unique: true, matchCount: 1, source: 'ancestor' };
  const contextSelector = selector.unique ? undefined : nearestContextSelector;
  const children = elementChildren(element).map((child, childIndex) => (
    transformNode(child, xpath, childIndex, resourceIdCounts, counts, selfContextSelector)
  ));
  return {
    id: `${xpath}-${attr(element, 'bounds') || index}`,
    label: nodeLabel(element),
    resourceId,
    text: attr(element, 'text'),
    contentDesc: attr(element, 'content-desc'),
    className,
    packageName: attr(element, 'package'),
    clickable: attr(element, 'clickable') === 'true',
    enabled: attr(element, 'enabled') !== 'false',
    xpath,
    bounds,
    selector,
    contextSelector,
    children,
  };
}

export function parseWindowHierarchy(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.querySelector('hierarchy > node') || doc.querySelector('node');
  if (!root) return null;
  const resourceIdCounts = new Map<string, number>();
  const counts: SelectorCounts = {
    contentDesc: new Map(),
    resourceId: resourceIdCounts,
    textClass: new Map(),
  };
  doc.querySelectorAll('node[resource-id]').forEach((element) => {
    const resourceId = attr(element, 'resource-id');
    if (resourceId) resourceIdCounts.set(resourceId, (resourceIdCounts.get(resourceId) || 0) + 1);
  });
  doc.querySelectorAll('node[content-desc]').forEach((element) => {
    const contentDesc = attr(element, 'content-desc');
    if (contentDesc) counts.contentDesc.set(contentDesc, (counts.contentDesc.get(contentDesc) || 0) + 1);
  });
  doc.querySelectorAll('node[text]').forEach((element) => {
    const text = attr(element, 'text');
    if (text) {
      const key = textClassKey(element);
      counts.textClass.set(key, (counts.textClass.get(key) || 0) + 1);
    }
  });
  return transformNode(root, '', 0, resourceIdCounts, counts);
}

export function flattenNodes(node: AppiumNode | null): AppiumNode[] {
  if (!node) return [];
  return [node, ...node.children.flatMap((child) => flattenNodes(child))];
}

export function findSmallestNodeAtPoint(node: AppiumNode | null, x: number, y: number) {
  if (!node) return null;
  let result: AppiumNode | null = null;
  let resultArea = Number.POSITIVE_INFINITY;

  for (const item of flattenNodes(node)) {
    const bounds = item.bounds;
    if (!bounds) continue;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
    const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
    if (area <= resultArea) {
      result = item;
      resultArea = area;
    }
  }

  return result;
}
