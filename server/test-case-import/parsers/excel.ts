import * as XLSX from 'xlsx';
import { normalizeExtractedText, splitCellItems } from '../text-normalizer';
import type { ImportedTestCase } from '../types';

const aliases = {
  title: ['用例名称', '用例标题', '测试用例', '场景标题', '测试场景', 'case name', 'title'],
  preconditions: ['前置条件', '前提条件', '准备条件', 'precondition', 'preconditions'],
  steps: ['测试步骤', '操作步骤', '执行步骤', '步骤', '操作', 'step', 'steps'],
  expectedResults: ['预期结果', '期望结果', '预期', 'expected result', 'expected results', 'expected'],
  testData: ['测试数据', '输入数据', '数据', 'test data', 'input data'],
  priority: ['优先级', 'priority'],
} as const;

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s_\-:：()（）]/g, '');
}

function findCell(row: Record<string, unknown>, names: readonly string[]) {
  const normalizedNames = names.map(normalizeHeader);
  const entry = Object.entries(row).find(([header]) => normalizedNames.includes(normalizeHeader(header)));
  return entry?.[1];
}

function rowToCase(row: Record<string, unknown>, sheetName: string, index: number): ImportedTestCase | null {
  const title = String(findCell(row, aliases.title) ?? '').trim();
  const preconditions = splitCellItems(findCell(row, aliases.preconditions));
  const steps = splitCellItems(findCell(row, aliases.steps));
  const expectedResults = splitCellItems(findCell(row, aliases.expectedResults));
  const testData = splitCellItems(findCell(row, aliases.testData));
  const priority = String(findCell(row, aliases.priority) ?? '').trim();
  const hasRecognizedContent = Boolean(title || preconditions.length || steps.length || expectedResults.length || testData.length);
  if (!hasRecognizedContent) return null;

  return {
    title: title || `${sheetName} - 用例 ${index + 1}`,
    preconditions,
    steps,
    expectedResults,
    testData,
    description: [],
    priority,
  };
}

// Excel 按“每行一条用例”解析，同时保留 CSV 文本作为语义校验兜底。
export function parseExcel(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const cases: ImportedTestCase[] = [];
  const rawSections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    rows.forEach((row, index) => {
      const parsedCase = rowToCase(row, sheetName, index);
      if (parsedCase) cases.push(parsedCase);
    });

    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (csv) rawSections.push(`工作表：${sheetName}\n${csv}`);
  }

  return {
    rawText: normalizeExtractedText(rawSections.join('\n\n')),
    cases,
  };
}
