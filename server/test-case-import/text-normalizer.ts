import path from 'node:path';
import type { ImportedTestCase } from './types';

type SectionName = 'preconditions' | 'steps' | 'expectedResults' | 'testData' | 'description';

const sectionPatterns: Array<{ section: SectionName; pattern: RegExp }> = [
  { section: 'preconditions', pattern: /^(?:前置条件|前提条件|准备条件)\s*[:：]?\s*(.*)$/i },
  { section: 'steps', pattern: /^(?:测试步骤|操作步骤|执行步骤|步骤)\s*[:：]?\s*(.*)$/i },
  { section: 'expectedResults', pattern: /^(?:预期结果|期望结果|预期|expected\s*results?)\s*[:：]?\s*(.*)$/i },
  { section: 'testData', pattern: /^(?:测试数据|输入数据|数据)\s*[:：]?\s*(.*)$/i },
];

const caseTitlePattern = /^(?:#{1,3}\s*)?(?:测试)?(?:用例名称|用例标题|用例|场景标题|测试场景)\s*[:：]\s*(.+)$/i;
const priorityPattern = /^(?:优先级|priority)\s*[:：]\s*(.+)$/i;

export function normalizeExtractedText(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanListItem(value: string) {
  return value.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim();
}

function createCase(title: string): ImportedTestCase {
  return {
    title,
    preconditions: [],
    steps: [],
    expectedResults: [],
    testData: [],
    description: [],
    priority: '',
  };
}

// 将 TXT/Word 中常见的“字段标题 + 内容”结构转换为统一测试用例对象。
export function parseTextCases(rawText: string, fileName: string) {
  const text = normalizeExtractedText(rawText);
  const fallbackTitle = path.basename(fileName, path.extname(fileName)) || '导入测试用例';
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const cases: ImportedTestCase[] = [];
  let currentCase = createCase(fallbackTitle);
  let activeSection: SectionName = 'description';

  const pushCurrentCase = () => {
    const hasContent = [
      ...currentCase.preconditions,
      ...currentCase.steps,
      ...currentCase.expectedResults,
      ...currentCase.testData,
      ...currentCase.description,
    ].some(Boolean);
    if (hasContent) cases.push(currentCase);
  };

  for (const line of lines) {
    const titleMatch = line.match(caseTitlePattern);
    if (titleMatch) {
      pushCurrentCase();
      currentCase = createCase(titleMatch[1]?.trim() || fallbackTitle);
      activeSection = 'description';
      continue;
    }

    const priorityMatch = line.match(priorityPattern);
    if (priorityMatch) {
      currentCase.priority = priorityMatch[1]?.trim() || '';
      continue;
    }

    const sectionMatch = sectionPatterns.find(({ pattern }) => pattern.test(line));
    if (sectionMatch) {
      const match = line.match(sectionMatch.pattern);
      activeSection = sectionMatch.section;
      const inlineValue = cleanListItem(match?.[1] || '');
      if (inlineValue) currentCase[activeSection].push(inlineValue);
      continue;
    }

    const item = cleanListItem(line);
    if (item) currentCase[activeSection].push(item);
  }

  pushCurrentCase();
  return cases.length ? cases : [createCase(fallbackTitle)];
}

export function splitCellItems(value: unknown) {
  const text = normalizeExtractedText(String(value ?? ''));
  if (!text) return [];
  return text.split('\n').map(cleanListItem).filter(Boolean);
}
