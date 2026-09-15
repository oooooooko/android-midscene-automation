import type { AppiumNode } from './types';

export function xpathStringLiteral(value: string) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

function uiAutomatorLocator(node: AppiumNode) {
  // Prefer stable identifiers; adding current text to an ID selector would make it state-dependent.
  if (node.resourceId) return `new UiSelector().resourceId(${JSON.stringify(node.resourceId)})`;
  if (node.contentDesc) return `new UiSelector().description(${JSON.stringify(node.contentDesc)})`;
  const classClause = node.className && node.className !== 'node' ? `.className(${JSON.stringify(node.className)})` : '';
  if (node.text) return `new UiSelector().text(${JSON.stringify(node.text)})${classClause}`;
  return classClause ? `new UiSelector()${classClause}` : '';
}

export function nodeLocators(node: AppiumNode) {
  return [
    { name: 'Resource ID', attribute: 'resource-id', value: node.resourceId },
    { name: 'Accessibility ID', attribute: 'content-desc', value: node.contentDesc },
    { name: 'XPath', attribute: '', value: node.xpath },
    { name: 'UiAutomator', attribute: '', value: uiAutomatorLocator(node), warning: !node.resourceId && !node.contentDesc && !node.text && node.className && node.className !== 'node' ? '仅按组件类型匹配，可能匹配多个元素' : '' },
  ];
}
